export const IMAGE_PROVIDER_IDS = ['google', 'openai', 'fal']
export const VIDEO_PROVIDER_IDS = ['google', 'grok', 'fal', 'wavespeed', 'higgsfield']

function stageSchema(providerIds, description) {
  return {
    type: ['object', 'null'],
    description,
    properties: {
      provider: { type: 'string', enum: providerIds },
      model: { type: 'string' },
    },
    additionalProperties: false,
  }
}

export const SCENE_GENERATION_PATCH_SCHEMA = {
  type: 'object',
  description: 'Per-scene provider/model overrides. Omitted stage preserves; null stage inherits global.',
  properties: {
    image: stageSchema(IMAGE_PROVIDER_IDS, 'Image generation override'),
    video: {
      type: ['object', 'null'],
      properties: {
        t2v: stageSchema(VIDEO_PROVIDER_IDS, 'Text-to-video override'),
        i2v: stageSchema(VIDEO_PROVIDER_IDS, 'Image-to-video override'),
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
}
