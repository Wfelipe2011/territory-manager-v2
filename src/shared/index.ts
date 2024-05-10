import { BadRequestException } from '@nestjs/common';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

export const uuid = () => {
  return uuidv4();
};

export const calculateExpiresIn = (expirationTime: string) => {
  const currentTime = Date.now();
  const expirationDate = dayjs(expirationTime).toDate();
  const expirationTimeMs = expirationDate.getTime();
  const expiresInMs = expirationTimeMs - currentTime;
  const expiresIn = `${Math.floor(expiresInMs / 1000)}s`; // Converte para segundos
  return expiresIn;
};
