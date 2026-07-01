// tests/skill_http_fetch.test.ts
import { SkillContext, TestData } from '../types';
import { HttpFetchSkill } from './skills/HttpFetchSkill';

describe('HTTP Fetch Skill', () => {
  it('should successfully fetch data from a valid endpoint and return status 200', async () => {
    const mockResponse = '{"status": "success", "data": "fetched"}';
    // Mock the underlying network call
    const networkLayer = jest.fn(() => Promise.resolve({ status: 200, body: mockResponse }));

    const skillInstance = new HttpFetchSkill({ networkLayer });
    
    const result = await skillInstance.execute('https://api.example/data');
    expect(result).toContain('"status": "success"');
  });

  it('should handle 4xx/5xx server errors gracefully', async () => {
    // Test case for connection timeouts or bad status codes
  });
});