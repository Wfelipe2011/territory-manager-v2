import { BadRequestException } from '@nestjs/common';
import dayjs from 'dayjs';

export class SignatureDate {
  isValidDate(dateString: string): void {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/; // Padrão para "YYYY-MM-DD"
    if (dateRegex.test(dateString)) return;
    throw new BadRequestException('Data inválida');
  }

  now(): Date {
    return dayjs().toDate();
  }

  generateExpirationDate(expirationTime: string): Date {
    return dayjs(`${expirationTime} 23:59:59`).toDate();
  }
}
