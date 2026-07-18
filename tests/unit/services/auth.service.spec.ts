/**
 * Testes unitários do AuthService.
 *
 * vi.mock é içado (hoisted) pelo Vitest antes de qualquer import, garantindo que
 * @/config/env, bcryptjs e node:crypto sejam substituídos antes de auth.service.ts
 * ser carregado — evitando assim o process.exit(1) do validador de variáveis de ambiente.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { hash, compare } from 'bcryptjs';

const googleMocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks globais — hoisted pelo Vitest antes de qualquer import
// ---------------------------------------------------------------------------

vi.mock('@/config/env', () => ({
  env: {
    JWT_SECRET: 'super-secret-key-for-integration-tests-min32!!',
    JWT_EXPIRES_IN: '1h',
    JWT_REFRESH_EXPIRES_IN: '7d',
    GEMINI_API_KEY: 'test-gemini-api-key',
    GOOGLE_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
    GMAIL_API_CLIENT_ID: '',
    GMAIL_API_CLIENT_SECRET: '',
    GMAIL_API_REFRESH_TOKEN: '',
    GMAIL_FROM_EMAIL: '',
    PASSWORD_RESET_URL: 'http://localhost:5173/?resetPassword=1',
    WHATSAPP_ADMIN_PHONES: '11999999999',
    ADMIN_PANEL_LOGIN: 'aleta0129',
    ADMIN_PANEL_PASSWORD: '123',
    ADMIN_PANEL_USER_EMAIL: 'admin@example.com',
    PORT: 3001,
    NODE_ENV: 'test',
  },
}));

vi.mock('bcryptjs', () => ({
  hash: vi.fn().mockResolvedValue('hashed_password'),
  compare: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('mock-refresh-token-uuid'),
  randomBytes: vi.fn().mockReturnValue({ toString: () => 'mock-password-reset-token' }),
  createHash: vi.fn().mockImplementation(() => ({
    update: vi.fn().mockImplementation((value: string) => ({
      digest: vi.fn().mockImplementation((encoding?: string) =>
        encoding === 'hex' ? 'mock-token-hash' : Buffer.from(value)),
    })),
  })),
  timingSafeEqual: vi.fn().mockImplementation((left: Buffer, right: Buffer) => left.equals(right)),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = googleMocks.verifyIdToken;
  },
}));

// ---------------------------------------------------------------------------
// Imports dos módulos reais (após os mocks)
// ---------------------------------------------------------------------------

import { AuthService, isWhatsappAdminPhone } from '@/modules/auth/auth.service';
import { PrismaService } from '@/config/database';
import {
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@/common/errors/app.exception';

// ---------------------------------------------------------------------------
// Fixtures reutilizáveis
// ---------------------------------------------------------------------------

const mockUser = {
  id: 'user-1',
  name: 'Gustavo Santos',
  phone: '11999999999',
  email: 'gustavo@example.com',
  passwordHash: 'hashed_password',
  googleSubject: null,
  accessStatus: 'ACTIVE' as const,
  paidUntil: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
const pastDate = new Date(Date.now() - 1_000);

const mockStoredRefreshToken = {
  id: 'rt-1',
  token: 'valid-refresh-token',
  userId: 'user-1',
  expiresAt: futureDate,
  createdAt: new Date(),
  user: mockUser,
};

// ---------------------------------------------------------------------------
// Helpers para criar os mocks a cada teste (evita vazamento de estado)
// ---------------------------------------------------------------------------

function makePrismaMock() {
  return {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    passwordResetToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    transaction: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    salesChannel: { findMany: vi.fn() },
    financialAccount: { findMany: vi.fn() },
    creditCard: { findMany: vi.fn() },
    categoryBudget: { findMany: vi.fn() },
    recurringTransaction: { findMany: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  };
}

function makeJwtMock() {
  return {
    signAsync: vi.fn().mockResolvedValue('mock-access-token'),
  };
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: ReturnType<typeof makePrismaMock>;
  let mockJwtService: ReturnType<typeof makeJwtMock>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPrisma = makePrismaMock();
    mockJwtService = makeJwtMock();

    // Defaults para o método privado issueTokens (chamado por register, login e refresh)
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.refreshToken.findMany.mockResolvedValue([]);
    mockPrisma.refreshToken.create.mockResolvedValue({
      id: 'rt-1',
      token: 'mock-refresh-token-uuid',
      userId: 'user-1',
      expiresAt: futureDate,
      createdAt: new Date(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // =========================================================================
  // register
  // =========================================================================

  describe('register', () => {
    it('(1) cria usuário com sucesso e retorna accessToken e refreshToken', async () => {
      // Arrange
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);

      // Act
      const result = await service.register({
        name: 'Gustavo Santos',
        phone: '11999999999',
        email: 'gustavo@example.com',
        password: 'senha1234',
      });

      // Assert — tokens retornados
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token-uuid',
      });

      // Assert — hash chamado com a senha correta
      expect(hash).toHaveBeenCalledWith('senha1234', 10);

      // Assert — usuário criado com os dados corretos
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          name: 'Gustavo Santos',
          phone: '11999999999',
          email: 'gustavo@example.com',
          passwordHash: 'hashed_password',
        },
      });
    });

    it('(2) lança ConflictException quando telefone já está cadastrado', async () => {
      // Arrange — usuário existente encontrado
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(
        service.register({
          name: 'Outro Usuário',
          phone: '11999999999',
          email: 'outro@example.com',
          password: 'senha1234',
        }),
      ).rejects.toThrow(ConflictException);

      // Usuário NÃO deve ter sido criado
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // login
  // =========================================================================

  describe('login', () => {
    it('(3) retorna tokens ao fazer login com telefone válido', async () => {
      // Arrange
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      vi.mocked(compare).mockResolvedValue(true as never);

      // Act
      const result = await service.login({
        phone: '11999999999',
        password: 'senha1234',
      });

      // Assert
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token-uuid',
      });
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { phone: '11999999999' },
      });
    });

    it('(4) retorna tokens ao fazer login com e-mail válido', async () => {
      // Arrange
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      vi.mocked(compare).mockResolvedValue(true as never);

      // Act
      const result = await service.login({
        email: 'joao@example.com',
        password: 'senha1234',
      });

      // Assert
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token-uuid',
      });
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'joao@example.com' },
      });
    });

    it('(5) lança BadRequestException quando nem phone nem email são fornecidos', async () => {
      // Act & Assert — cast necessário para simular body inválido sem validação de DTO
      await expect(
        service.login({ password: 'senha1234' } as never),
      ).rejects.toThrow(BadRequestException);

      // Nenhuma consulta ao banco deve ter ocorrido
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('(6) lança UnauthorizedException quando usuário não é encontrado', async () => {
      // Arrange
      mockPrisma.user.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.login({ phone: '11999999999', password: 'senha1234' }),
      ).rejects.toThrow(UnauthorizedException);

      // compare NÃO deve ter sido chamado
      expect(compare).not.toHaveBeenCalled();
    });

    it('(7) lança UnauthorizedException quando a senha está incorreta', async () => {
      // Arrange
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      vi.mocked(compare).mockResolvedValue(false as never);

      // Act & Assert
      await expect(
        service.login({ phone: '11999999999', password: 'senha_errada' }),
      ).rejects.toThrow(UnauthorizedException);

      // compare DEVE ter sido chamado com a senha enviada e o hash armazenado
      expect(compare).toHaveBeenCalledWith('senha_errada', mockUser.passwordHash);
    });
  });

  describe('adminLogin', () => {
    it('autentica a credencial exclusiva e vincula a sessão ao administrador', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      const result = await service.adminLogin({ login: 'aleta0129', password: '123' });

      expect(result).toEqual({ accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token-uuid' });
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { phone: { in: expect.arrayContaining(['11999999999', '5511999999999']) } },
            { email: 'admin@example.com' },
          ],
        },
      });
    });

    it('rejeita login ou senha administrativa incorretos', async () => {
      await expect(service.adminLogin({ login: 'aleta0129', password: 'errada' }))
        .rejects.toThrow('Login ou senha administrativa inválidos');
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // refresh
  // =========================================================================

  describe('refresh', () => {
    it('(8) deleta token antigo e retorna novos tokens quando token é válido e não expirado', async () => {
      // Arrange
      mockPrisma.refreshToken.findUnique.mockResolvedValue(mockStoredRefreshToken);
      mockPrisma.refreshToken.delete.mockResolvedValue(mockStoredRefreshToken);

      // Act
      const result = await service.refresh('valid-refresh-token');

      // Assert — token antigo deletado pelo id
      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: mockStoredRefreshToken.id },
      });

      // Assert — novos tokens retornados
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token-uuid',
      });
    });

    it('(9) lança UnauthorizedException quando token não é encontrado no banco', async () => {
      // Arrange
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.refresh('token-inexistente')).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.refreshToken.delete).not.toHaveBeenCalled();
    });

    it('(10) lança UnauthorizedException quando token está expirado', async () => {
      // Arrange — token com data de expiração no passado
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        ...mockStoredRefreshToken,
        expiresAt: pastDate,
      });

      // Act & Assert
      await expect(service.refresh('valid-refresh-token')).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.refreshToken.delete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // logout
  // =========================================================================

  describe('logout', () => {
    it('(11) resolve sem erro (usa deleteMany, não falha se token não existir)', async () => {
      // Arrange — deleteMany já mockado no beforeEach com count: 0
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      // Act & Assert
      await expect(service.logout('qualquer-token')).resolves.toBeUndefined();

      // Assert — deleteMany chamado com o token correto
      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'qualquer-token' },
      });
    });
  });

  // =========================================================================
  // me
  // =========================================================================

  describe('me', () => {
    it('(12) retorna { id, name, phone, email } quando usuário é encontrado', async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      // Act
      const result = await service.me('user-1');

      // Assert
      expect(result).toEqual({
        id: 'user-1',
        name: 'Gustavo Santos',
        phone: '11999999999',
        email: 'gustavo@example.com',
        isWhatsappAdmin: true,
        accessStatus: 'ACTIVE',
        paidUntil: null,
      });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('(13) lança NotFoundException quando usuário não é encontrado', async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.me('user-inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // updateProfile
  // =========================================================================

  describe('updateProfile', () => {
    it('(14) atualiza o nome e chama prisma.user.update somente com o campo name', async () => {
      // Arrange
      const updatedUser = { ...mockUser, name: 'Novo Nome' };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      // Act
      const result = await service.updateProfile('user-1', { name: 'Novo Nome' });

      // Assert — update chamado exatamente com os dados esperados
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'Novo Nome' },
      });

      // Assert — retorno reflete o usuário atualizado
      expect(result).toMatchObject({ id: 'user-1', name: 'Novo Nome' });

      // Assert — hash NÃO foi chamado (sem mudança de senha)
      expect(hash).not.toHaveBeenCalled();
    });

    it('(15) atualiza a senha chamando hash e salvando passwordHash no banco', async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);

      // Act
      await service.updateProfile('user-1', { password: 'novasenha123' });

      // Assert — hash chamado com a nova senha e o custo correto
      expect(hash).toHaveBeenCalledWith('novasenha123', 10);

      // Assert — update chamado com o hash resultante (não a senha em texto puro)
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed_password' },
      });
    });

    it('(16) lança NotFoundException quando usuário não é encontrado', async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateProfile('user-inexistente', { name: 'Nome Qualquer' }),
      ).rejects.toThrow(NotFoundException);

      // update NÃO deve ter sido chamado
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('isWhatsappAdminPhone', () => {
    it('reconhece admin com ou sem DDI do Brasil', () => {
      expect(isWhatsappAdminPhone('11999999999')).toBe(true);
      expect(isWhatsappAdminPhone('5511999999999')).toBe(true);
      expect(isWhatsappAdminPhone('+55 (11) 99999-9999')).toBe(true);
      expect(isWhatsappAdminPhone('11888888888')).toBe(false);
    });

    it('(8) orienta login Google quando a conta não possui senha', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...mockUser, passwordHash: null });

      await expect(
        service.login({ email: 'gustavo@example.com', password: 'senha1234' }),
      ).rejects.toThrow('Use o botão Continuar com Google para entrar');
      expect(compare).not.toHaveBeenCalled();
    });
  });

  describe('googleLogin', () => {
    const googlePayload = {
      sub: 'google-sub-1',
      email: 'gustavo@example.com',
      email_verified: true,
      name: 'Gustavo Santos',
    };

    beforeEach(() => {
      googleMocks.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });
    });

    it('(9) vincula uma conta existente pelo e-mail verificado', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({ ...mockUser, googleSubject: googlePayload.sub });

      const result = await service.googleLogin({ credential: 'google-id-token-value-long' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { googleSubject: googlePayload.sub },
      });
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token-uuid',
      });
    });

    it('(10) solicita telefone para uma nova conta Google', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.googleLogin({ credential: 'google-id-token-value-long' }),
      ).resolves.toEqual({ requiresPhone: true });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('(11) cria uma nova conta Google após receber o telefone', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
        googleSubject: googlePayload.sub,
      });

      const result = await service.googleLogin({
        credential: 'google-id-token-value-long',
        phone: '11999999999',
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          name: 'Gustavo Santos',
          phone: '11999999999',
          email: 'gustavo@example.com',
          passwordHash: null,
          googleSubject: googlePayload.sub,
        },
      });
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token-uuid',
      });
    });

    it('(12) rejeita credencial Google inválida', async () => {
      googleMocks.verifyIdToken.mockRejectedValue(new Error('invalid token'));

      await expect(
        service.googleLogin({ credential: 'google-id-token-value-long' }),
      ).rejects.toThrow('Não foi possível validar sua conta Google');
    });
  });

  describe('password recovery', () => {
    it('não revela quando o e-mail não está cadastrado', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.requestPasswordReset('naoexiste@example.com')).resolves.toBeUndefined();
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('invalida tokens anteriores e cria um token armazenado como hash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({});

      await service.requestPasswordReset('GUSTAVO@example.com');

      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenHash: 'mock-token-hash',
          userId: mockUser.id,
        }),
      });
    });

    it('rejeita token expirado sem alterar a senha', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-1',
        userId: mockUser.id,
        tokenHash: 'mock-token-hash',
        expiresAt: pastDate,
        usedAt: null,
      });

      await expect(service.resetPassword('token-valid-with-more-than-32-characters', 'novaSenha123')).rejects.toThrow(
        'Link de recuperação inválido ou expirado',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('privacy and account management', () => {
    it('exige a senha atual antes de excluir uma conta com senha', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      vi.mocked(compare).mockResolvedValue(false as never);

      await expect(service.deleteAccount(mockUser.id, 'senha-incorreta')).rejects.toThrow('Senha atual inválida');
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('exclui a conta quando a senha atual é válida', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      vi.mocked(compare).mockResolvedValue(true as never);
      mockPrisma.user.delete.mockResolvedValue(mockUser);

      await service.deleteAccount(mockUser.id, 'senha-correta');

      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: mockUser.id } });
    });
  });
});
