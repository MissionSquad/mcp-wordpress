import { describe, expect, it } from 'vitest'
import { getAcfSchemaSchema } from '../src/tools/acf.js'

describe('getAcfSchemaSchema', () => {
  it('defaults a target-only content schema request to posts', () => {
    const parsed = getAcfSchemaSchema.parse({
      target: 'content',
    })

    expect(parsed).toEqual({
      target: 'content',
      resource: 'post',
    })
  })

  it('accepts blank optional form fields for a content schema request', () => {
    const parsed = getAcfSchemaSchema.parse({
      target: 'content',
      content_type: 'post',
      taxonomy: '',
      id: '',
    })

    expect(parsed).toEqual({
      target: 'content',
      resource: 'post',
      content_type: 'post',
      taxonomy: '',
      id: '',
    })
  })

  it('accepts numeric string ids from form inputs', () => {
    const parsed = getAcfSchemaSchema.parse({
      target: 'content',
      content_type: 'post',
      id: '123',
    })

    expect(parsed.id).toBe('123')
  })

  it('accepts common target aliases and extra llm-supplied fields', () => {
    const parsed = getAcfSchemaSchema.parse({
      target: 'posts',
      content_type: 'page',
      reason: 'inspect ACF fields',
    })

    expect(parsed).toMatchObject({
      target: 'content',
      resource: 'post',
      content_type: 'page',
      reason: 'inspect ACF fields',
    })
  })

  it('defaults an omitted target to content', () => {
    const parsed = getAcfSchemaSchema.parse({})

    expect(parsed).toMatchObject({
      target: 'content',
      resource: 'post',
    })
  })
})
