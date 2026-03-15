import { describe, it, expect, vi } from 'vitest';
import { getToolCallSignature, registerToolCall, isUsableFinalResponse, resolveInitialUserMessage } from '../../server/models/agentEngine.js';

describe('agentEngine helpers', () => {
  describe('getToolCallSignature', () => {
    it('should generate stable signature for JSON arguments', () => {
      const toolCall = {
        function: {
          name: 'test_tool',
          arguments: JSON.stringify({ b: 2, a: 1 })
        }
      };
      // Keys should be sorted: a, then b
      expect(getToolCallSignature(toolCall)).toBe('test_tool:{"a":1,"b":2}');
    });

    it('should handle missing arguments', () => {
      const toolCall = { function: { name: 'test_tool' } };
      expect(getToolCallSignature(toolCall)).toBe('test_tool:');
    });

    it('should fallback to raw string on invalid JSON', () => {
      const toolCall = {
        function: {
          name: 'test_tool',
          arguments: '{invalid_json}'
        }
      };
      expect(getToolCallSignature(toolCall)).toBe('test_tool:{invalid_json}');
    });
  });

  describe('registerToolCall', () => {
    it('should track counts and detect over-budget calls', () => {
      const counts = new Map();
      const toolCall = { function: { name: 'tool', arguments: '{}' } };
      
      const res1 = registerToolCall(counts, toolCall, 2);
      expect(res1.count).toBe(1);
      expect(res1.overBudget).toBe(false);

      const res2 = registerToolCall(counts, toolCall, 2);
      expect(res2.count).toBe(2);
      expect(res2.overBudget).toBe(false);

      const res3 = registerToolCall(counts, toolCall, 2);
      expect(res3.count).toBe(3);
      expect(res3.overBudget).toBe(true);
    });
  });

  describe('isUsableFinalResponse', () => {
    it('should return false for tool-call patterns', () => {
      expect(isUsableFinalResponse('<tool_call name="xyz">')).toBe(false);
      expect(isUsableFinalResponse('Final answer: <parameter>')).toBe(false);
    });

    it('should return true for clean text', () => {
      expect(isUsableFinalResponse('The result is 42.')).toBe(true);
    });

    it('should return false for empty content', () => {
      expect(isUsableFinalResponse('')).toBe(false);
    });
  });

  describe('resolveInitialUserMessage', () => {
    it('should use provided message if exists', () => {
      expect(resolveInitialUserMessage({}, 'Hello')).toBe('Hello');
    });

    it('should use default task prompt if initial message is empty', () => {
      const task = { name: 'Refactor Code' };
      expect(resolveInitialUserMessage(task, '')).toContain('Refactor Code');
    });
  });
});
