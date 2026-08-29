import { registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET as string,
  jwtExpiration: process.env.JWT_EXPIRATION ?? '1d',
  bcryptCost: Number(process.env.BCRYPT_COST ?? 10),
}));
