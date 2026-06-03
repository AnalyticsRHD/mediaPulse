import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
import axios from 'axios';

type HttpRequest = { method: string; url: string };
type HttpResponse = { status: (code: number) => { json: (body: unknown) => void } };

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponse>();
    const request = ctx.getRequest<HttpRequest>();
    const handled = this.normalizeException(exception);

    if (handled.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${handled.statusCode}: ${handled.message}`,
        exception instanceof Error ? exception.stack : String(exception)
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${handled.statusCode}: ${handled.message}`);
    }

    response.status(handled.statusCode).json({
      statusCode: handled.statusCode,
      error: handled.error,
      message: handled.message,
      path: request.url,
      timestamp: new Date().toISOString()
    });
  }

  private normalizeException(exception: unknown): { statusCode: number; error: string; message: string } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null) {
        const typedBody = body as { error?: string; message?: string | string[] };
        const message = Array.isArray(typedBody.message)
          ? typedBody.message.join(', ')
          : typedBody.message || exception.message;

        return {
          statusCode,
          error: typedBody.error || this.statusText(statusCode),
          message
        };
      }

      return {
        statusCode,
        error: this.statusText(statusCode),
        message: String(body || exception.message)
      };
    }

    if (axios.isAxiosError(exception)) {
      const statusCode = exception.response?.status
        ? HttpStatus.BAD_GATEWAY
        : HttpStatus.SERVICE_UNAVAILABLE;

      return {
        statusCode,
        error: this.statusText(statusCode),
        message: exception.response?.status
          ? `External service returned ${exception.response.status}`
          : 'External service is unavailable'
      };
    }

    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: this.statusText(HttpStatus.SERVICE_UNAVAILABLE),
      message: exception instanceof Error
        ? exception.message || 'Service temporarily unavailable'
        : 'Service temporarily unavailable'
    };
  }

  private statusText(statusCode: number): string {
    return HttpStatus[statusCode] || 'Error';
  }
}
