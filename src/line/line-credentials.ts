import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** Encrypts LINE credentials at rest. The master key never leaves server configuration. */
@Injectable()
export class LineCredentialsService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string): string {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  decrypt(value: string): string {
    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.');
    if (version !== 'v1' || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new BadRequestException('Stored LINE credential is invalid');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivEncoded, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new BadRequestException('Stored LINE credential cannot be decrypted');
    }
  }

  private key(): Buffer {
    const encoded = this.config.getOrThrow<string>('LINE_CREDENTIAL_ENCRYPTION_KEY');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('LINE_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    return key;
  }
}
