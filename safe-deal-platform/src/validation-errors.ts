import { BadRequestException, ValidationError } from '@nestjs/common';

/** Structured 400 payload — prefer `{ field, error }` over generic Bad Request. */
export function fieldBadRequest(field: string, error: string): BadRequestException {
  return new BadRequestException({ field, error, message: error });
}

function firstConstraint(error: ValidationError): { field: string; error: string } {
  if (error.constraints && Object.keys(error.constraints).length) {
    const message = Object.values(error.constraints)[0] ?? 'invalid';
    return { field: error.property, error: message };
  }
  const child = error.children?.[0];
  if (child) {
    const nested = firstConstraint(child);
    return {
      field: nested.field ? `${error.property}.${nested.field}` : error.property,
      error: nested.error,
    };
  }
  return { field: error.property, error: 'invalid' };
}

/** Nest ValidationPipe exceptionFactory → `{ field, error }` JSON. */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const first = errors[0] ? firstConstraint(errors[0]) : { field: 'body', error: 'Bad Request' };
  const messages = errors.flatMap((err) => {
    if (err.constraints) return Object.values(err.constraints);
    return err.children?.length ? [firstConstraint(err).error] : [`${err.property} is invalid`];
  });
  return new BadRequestException({
    field: first.field,
    error: first.error,
    message: messages.length === 1 ? messages[0] : messages,
  });
}
