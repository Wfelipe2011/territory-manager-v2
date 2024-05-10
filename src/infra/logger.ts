import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import winston from "winston";
import winstonDailyRotateFile from 'winston-daily-rotate-file';

const logtail = new Logtail(process.env.LOGTAIL_API_KEY!);

const isDevelopment = () => process.env.NODE_ENV === 'dev';

const format = winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.json(),
)

const alignColorsAndTime = winston.format.combine(
    winston.format.colorize({
        all: true
    }),
    winston.format.timestamp({
        format: "YY-MM-DD HH:MM:SS"
    }),
    winston.format.printf(
        info => `[${info.timestamp}]  ${info.level} : ${info.message}`
    )
);

const logTransport = new winstonDailyRotateFile({
    format,
    handleExceptions: true,
    filename: 'logs/%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '200m', // Defina o tamanho máximo do arquivo conforme necessário.
    maxFiles: '14d' // Mantenha os logs por até 14 dias.
});

export const logger = winston.createLogger({
    level: 'info',
    handleExceptions: true,
    format,
    transports: [],
});

if (!isDevelopment()) {
    logger.add(new LogtailTransport(logtail, {
        level: 'info',
        handleExceptions: true,
        format,
    }));
    logger.add(logTransport)
}

logger.add(new winston.transports.Console({
    level: 'debug',
    handleExceptions: true,
    format: alignColorsAndTime,
}));
