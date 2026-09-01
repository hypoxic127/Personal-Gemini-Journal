import { describe, it, expect } from 'vitest';
import { MoodEnum, CreateMessageSchema } from '@journal/shared';

describe('Scaffold & Shared Schema Tests', () => {
  it('should validate valid mood enums', () => {
    expect(MoodEnum.safeParse('joyful').success).toBe(true);
    expect(MoodEnum.safeParse('invalid_mood').success).toBe(false);
  });

  it('should validate message inputs', () => {
    expect(CreateMessageSchema.safeParse({ text: 'Hello journal' }).success).toBe(true);
    expect(CreateMessageSchema.safeParse({ text: '' }).success).toBe(false);
  });
});