import { Injectable, type PipeTransform } from '@nestjs/common';
import { DomainError } from './domain-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Refuses a path parameter that is not a UUID, before it reaches the database.
 *
 * Without this, `GET /v1/precheckins/foo/documents` passed `foo` straight into a query and
 * Postgres answered `invalid input syntax for type uuid`, which surfaced as a 500 with a
 * stack trace in the log. Three things were wrong with that: a malformed request is the
 * client's fault and should be a refusal, not a server error; a 500 on every junk id makes
 * a scanner's traffic indistinguishable from a real fault in the logs; and the difference
 * between "not a uuid" (500) and "a uuid that does not exist" (400) told an unauthenticated
 * caller which ids were well-formed.
 *
 * The refusal is a plain VALIDATION_FAILED, the same as an id that parses but matches
 * nothing, so the two remain indistinguishable from outside.
 */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) {
      // A pipe runs before any handler and cannot see the request, so it has no
      // correlation id. The exception filter substitutes the request's own.
      throw new DomainError('VALIDATION_FAILED', '', 'malformed id in path');
    }
    return value;
  }
}
