import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, compare } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
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

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
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

    const valid = await compare(input.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    return this.issueTokens(user.id, user.phone, user.email ?? undefined);
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
    };
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileDto,
  ): Promise<{ id: string; name: string; phone: string; email: string | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.password !== undefined) data.passwordHash = await hash(input.password, 10);

    const updated = await this.prisma.user.update({ where: { id: userId }, data });
    return { id: updated.id, name: updated.name, phone: updated.phone, email: updated.email };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
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
