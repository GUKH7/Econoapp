import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, compare } from 'bcryptjs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '@/config/database';
import {
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@/common/errors/app.exception';
import { env } from '@/config/env';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { AdminLoginDto } from './dto/admin-login.dto';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function googleClientIds(): string[] {
  return env.GOOGLE_CLIENT_ID.split(',').map((clientId) => clientId.trim()).filter(Boolean);
}

function gmailApiConfigured(): boolean {
  return Boolean(
    env.GMAIL_API_CLIENT_ID &&
      env.GMAIL_API_CLIENT_SECRET &&
      env.GMAIL_API_REFRESH_TOKEN &&
      env.GMAIL_FROM_EMAIL,
  );
}

function parseDurationToMs(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new BadRequestException('Formato inválido para duração de token');
  }
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new BadRequestException('Unidade de duração inválida');
  }
  return amount * multiplier;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient = new OAuth2Client();
  private readonly mimeMailer = nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterDto): Promise<AuthTokens> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])],
      },
    });
    if (existing) {
      throw new ConflictException('Usuário com mesmo telefone ou email já existe');
    }

    const passwordHash = await hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        passwordHash,
      },
    });

    return this.issueTokens(user.id, user.phone, user.email ?? undefined);
  }

  async login(input: LoginDto): Promise<AuthTokens> {
    const where = input.phone
      ? { phone: input.phone }
      : input.email
        ? { email: input.email }
        : null;

    if (!where) {
      throw new BadRequestException('Informe email ou telefone para login');
    }

    const user = await this.prisma.user.findFirst({ where });
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Use o botão Continuar com Google para entrar');
    }

    const valid = await compare(input.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    return this.issueTokens(user.id, user.phone, user.email ?? undefined);
  }

  async adminLogin(input: AdminLoginDto): Promise<AuthTokens> {
    const loginMatches = secureValueMatches(input.login, env.ADMIN_PANEL_LOGIN);
    const passwordMatches = secureValueMatches(input.password, env.ADMIN_PANEL_PASSWORD);
    if (!env.ADMIN_PANEL_LOGIN || !env.ADMIN_PANEL_PASSWORD || !loginMatches || !passwordMatches) {
      throw new UnauthorizedException('Login ou senha administrativa inválidos');
    }

    const adminPhones = [...new Set(env.WHATSAPP_ADMIN_PHONES.split(',').flatMap(phoneCandidates))];
    const adminEmail = env.ADMIN_PANEL_USER_EMAIL.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(adminPhones.length ? [{ phone: { in: adminPhones } }] : []),
          ...(adminEmail ? [{ email: adminEmail }] : []),
        ],
      },
    });
    if (!user) throw new UnauthorizedException('Conta administrativa não configurada');
    return this.issueTokens(user.id, user.phone, user.email ?? undefined);
  }

  async googleLogin(input: GoogleLoginDto): Promise<AuthTokens | { requiresPhone: true }> {
    const clientIds = googleClientIds();
    if (!clientIds.length) {
      throw new BadRequestException('Login com Google ainda nao foi configurado');
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: input.credential,
        audience: clientIds,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Não foi possível validar sua conta Google');
    }

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException('A conta Google precisa ter um e-mail verificado');
    }

    const email = payload.email.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ googleSubject: payload.sub }, { email }] },
    });

    if (user) {
      if (user.googleSubject && user.googleSubject !== payload.sub) {
        throw new ConflictException('Este e-mail já está vinculado a outra conta Google');
      }
      if (!user.googleSubject) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { googleSubject: payload.sub },
        });
      }
      return this.issueTokens(user.id, user.phone, user.email ?? undefined);
    }

    if (!input.phone) return { requiresPhone: true };

    const phoneOwner = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    if (phoneOwner) {
      throw new ConflictException('Este telefone já está vinculado a outra conta');
    }

    const created = await this.prisma.user.create({
      data: {
        name: payload.name?.trim() || email.split('@')[0] || 'Usuário',
        phone: input.phone,
        email,
        passwordHash: null,
        googleSubject: payload.sub,
      },
    });
    return this.issueTokens(created.id, created.phone, created.email ?? undefined);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    return this.issueTokens(stored.user.id, stored.user.phone, stored.user.email ?? undefined);
  }

  async me(
    userId: string,
  ): Promise<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
    isWhatsappAdmin: boolean;
    accessStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
    paidUntil: string | null;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      isWhatsappAdmin: isWhatsappAdminPhone(user.phone),
      accessStatus: user.accessStatus,
      paidUntil: user.paidUntil?.toISOString() ?? null,
    };
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileDto,
  ): Promise<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
    accessStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
    paidUntil: string | null;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.password !== undefined) data.passwordHash = await hash(input.password, 10);

    const updated = await this.prisma.user.update({ where: { id: userId }, data });
    return {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      email: updated.email,
      accessStatus: updated.accessStatus,
      paidUntil: updated.paidUntil?.toISOString() ?? null,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return;

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash: passwordResetTokenHash(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    if (!gmailApiConfigured()) {
      this.logger.warn('Gmail API não configurada; e-mail de recuperação não enviado.');
      return;
    }

    const resetUrl = new URL(env.PASSWORD_RESET_URL);
    resetUrl.searchParams.set('token', token);
    try {
      await this.sendPasswordResetEmail({
        from: env.GMAIL_FROM_EMAIL,
        to: normalizedEmail,
        resetUrl: resetUrl.toString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(`Falha ao enviar e-mail de recuperação pela Gmail API: ${message}`);
      throw new BadRequestException('Não foi possível enviar o e-mail de recuperação');
    }
  }

  private async sendPasswordResetEmail(input: {
    from: string;
    to: string;
    resetUrl: string;
  }): Promise<void> {
    const oauthClient = new OAuth2Client(
      env.GMAIL_API_CLIENT_ID,
      env.GMAIL_API_CLIENT_SECRET,
    );
    oauthClient.setCredentials({ refresh_token: env.GMAIL_API_REFRESH_TOKEN });
    const accessToken = await oauthClient.getAccessToken();
    if (!accessToken.token) throw new Error('não foi possível obter acesso ao Gmail');

    const mail = await this.mimeMailer.sendMail({
      from: `Din <${input.from}>`,
      to: input.to,
      subject: 'Redefina sua senha do Din',
      text: `Recebemos uma solicitação para redefinir sua senha. Use este link em até 30 minutos: ${input.resetUrl}\n\nSe você não solicitou, ignore este e-mail.`,
      html: `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:560px;margin:auto"><h1 style="color:#00bfa6">Din</h1><h2>Redefina sua senha</h2><p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${input.resetUrl}" style="display:inline-block;background:#00bfa6;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Criar nova senha</a></p><p>Este link expira em 30 minutos e só pode ser usado uma vez.</p><p style="color:#64748b">Se você não solicitou, ignore este e-mail.</p></div>`,
    });
    const rawMessage = Buffer.isBuffer(mail.message)
      ? mail.message
      : Buffer.from(String(mail.message));
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawMessage.toString('base64url') }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`Google respondeu ${response.status}: ${details}`);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: passwordResetTokenHash(token) },
    });
    if (!stored || stored.usedAt || stored.expiresAt <= new Date()) {
      throw new BadRequestException('Link de recuperação inválido ou expirado');
    }

    const passwordHash = await hash(password, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: stored.userId } }),
    ]);
  }

  async exportAccountData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, email: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const [transactions, categories, channels, accounts, creditCards, budgets, recurringTransactions] =
      await Promise.all([
        this.prisma.transaction.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
        this.prisma.category.findMany({ where: { userId } }),
        this.prisma.salesChannel.findMany({ where: { userId } }),
        this.prisma.financialAccount.findMany({ where: { userId } }),
        this.prisma.creditCard.findMany({ where: { userId } }),
        this.prisma.categoryBudget.findMany({ where: { userId } }),
        this.prisma.recurringTransaction.findMany({ where: { userId } }),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      profile: user,
      transactions,
      categories,
      salesChannels: channels,
      accounts,
      creditCards,
      budgets,
      recurringTransactions,
    };
  }

  async deleteAccount(userId: string, password?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.passwordHash) {
      if (!password || !(await compare(password, user.passwordHash))) {
        throw new UnauthorizedException('Senha atual inválida');
      }
    }
    await this.prisma.user.delete({ where: { id: userId } });
  }

  private async issueTokens(userId: string, phone: string, email?: string): Promise<AuthTokens> {
    // Limpar tokens expirados
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    // Manter no máximo 4 sessões antigas (o novo token será a 5ª)
    const existingTokens = await this.prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existingTokens.length >= 5) {
      const idsToDelete = existingTokens.slice(0, existingTokens.length - 4).map((t) => t.id);
      await this.prisma.refreshToken.deleteMany({ where: { id: { in: idsToDelete } } });
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: userId, phone, email },
      { secret: env.JWT_SECRET },
    );
    const refreshToken = randomUUID();

    const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));
    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}

function passwordResetTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function secureValueMatches(received: string, expected: string): boolean {
  const receivedHash = createHash('sha256').update(received).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

export function isWhatsappAdminPhone(phone: string): boolean {
  const admins = new Set(env.WHATSAPP_ADMIN_PHONES.split(',').flatMap(phoneCandidates));
  if (!admins.size) return false;
  return phoneCandidates(phone).some((candidate) => admins.has(candidate));
}

function phoneCandidates(phone: string): string[] {
  const normalized = phone.replace(/\D/g, '');
  const withoutBrazilCode = normalized.startsWith('55') ? normalized.slice(2) : normalized;
  return [...new Set([normalized, withoutBrazilCode, `55${withoutBrazilCode}`].filter(Boolean))];
}
