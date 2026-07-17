import { describe, expect, it } from 'vitest';
import { parseMemberTokens } from '../utils/parseMemberTokens';

describe('group-chat-users', () => {
  it('parses bare ids', () => {
    expect(parseMemberTokens('1 2 3')).toEqual(['1', '2', '3']);
  });

  it('parses ONIX ids and commas', () => {
    expect(parseMemberTokens('ONIX-1, ONIX-2; ONIX-3')).toEqual(['ONIX-1', 'ONIX-2', 'ONIX-3']);
  });

  it('parses @usernames', () => {
    expect(parseMemberTokens('@user1 @user2')).toEqual(['user1', 'user2']);
  });

  it('dedupes case-insensitively', () => {
    expect(parseMemberTokens('ONIX-1 onix-1 1')).toEqual(['ONIX-1', '1']);
  });
});
