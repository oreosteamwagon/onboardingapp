import { sanitizeCourseHtml, validateHtmlLength } from '@/lib/sanitize'

describe('sanitizeCourseHtml', () => {
  it('strips script tags', () => {
    const result = sanitizeCourseHtml('<p>Hello</p><script>alert("xss")</script>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
    expect(result).toContain('<p>Hello</p>')
  })

  it('strips javascript: href', () => {
    const result = sanitizeCourseHtml('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain('javascript:')
  })

  it('strips onerror event attributes', () => {
    const result = sanitizeCourseHtml('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain('onerror')
  })

  it('strips style attributes', () => {
    const result = sanitizeCourseHtml('<p style="color:red">text</p>')
    expect(result).not.toContain('style=')
  })

  it('preserves safe p tags', () => {
    const result = sanitizeCourseHtml('<p>Safe paragraph</p>')
    expect(result).toContain('<p>Safe paragraph</p>')
  })

  it('preserves strong tags', () => {
    const result = sanitizeCourseHtml('<strong>bold</strong>')
    expect(result).toContain('<strong>bold</strong>')
  })

  it('preserves safe https links', () => {
    const result = sanitizeCourseHtml('<a href="https://example.com">link</a>')
    expect(result).toContain('href="https://example.com"')
  })

  it('preserves https images', () => {
    const result = sanitizeCourseHtml('<img src="https://example.com/img.png" alt="test">')
    expect(result).toContain('src="https://example.com/img.png"')
  })

  it('forces rel="noopener noreferrer" on a tags', () => {
    const result = sanitizeCourseHtml('<a href="https://example.com">link</a>')
    expect(result).toContain('rel="noopener noreferrer"')
  })

  it('discards iframe tags', () => {
    const result = sanitizeCourseHtml('<iframe src="https://evil.com"></iframe>')
    expect(result).not.toContain('<iframe')
  })
})

describe('validateHtmlLength', () => {
  it('returns null for content under 200KB', () => {
    const html = '<p>' + 'a'.repeat(100) + '</p>'
    expect(validateHtmlLength(html)).toBeNull()
  })

  it('returns error string for content over 200KB', () => {
    const html = '<p>' + 'a'.repeat(200_001) + '</p>'
    const result = validateHtmlLength(html)
    expect(typeof result).toBe('string')
    expect(result).toContain('200 KB')
  })
})
