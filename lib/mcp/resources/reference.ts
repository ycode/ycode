import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ELEMENT_TEMPLATES } from '@/lib/mcp/utils';

function getAvailableTemplates() {
  return Object.entries(ELEMENT_TEMPLATES).map(([key, t]) => ({
    key,
    name: t.name,
    description: t.description,
  }));
}

const EXAMPLE_PROMPTS = {
  description: 'Example prompts and tool usage patterns for common YCode tasks',
  quick_start: {
    title: 'Build a complete landing page',
    prompt: 'Create a modern landing page with a hero section, 3 feature cards, testimonials, and a dark CTA section.',
    workflow: [
      '1. create_page with name and slug',
      '2. batch_operations: add section + container + heading + text + buttons for hero',
      '3. batch_operations: add features section with 3-column grid of cards',
      '4. batch_operations: add testimonials section',
      '5. batch_operations: add dark CTA section',
      '6. publish to make it live',
    ],
  },
  tips: [
    'Use batch_operations whenever building more than 2-3 layers',
    'Create styles (create_style) before building repeating elements',
    'Always set isActive: true on design categories',
    'Use ref_id in batch_operations to reference layers created in the same batch',
    'Start with structure (sections + containers), then add content, then style',
    'Use add_layout for quick pre-built sections, then customize',
    'Always publish after completing changes',
  ],
};

export function registerReferenceResources(server: McpServer) {
  server.resource(
    'elements-reference',
    'ycode://reference/elements',
    {
      description: 'Available element types, nesting rules, and which elements can have children',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'ycode://reference/elements',
        mimeType: 'application/json',
        text: JSON.stringify({
          templates: getAvailableTemplates(),
          nesting_rules: {
            cannot_have_children: [
              'icon', 'image', 'audio', 'video', 'iframe',
              'text', 'span', 'label', 'hr',
              'input', 'textarea', 'select', 'checkbox', 'radio',
              'htmlEmbed',
            ],
            section_cannot_contain_section: true,
            links_cannot_nest: true,
            component_instances_are_readonly: true,
          },
          element_types: {
            structure: {
              section: 'Full-width page section.',
              div: 'Generic container.',
              container: 'Max-width container (1280px) with padding.',
              hr: 'Horizontal divider line.',
            },
            content: {
              heading: 'Heading text (h1). 48px bold.',
              text: 'Paragraph text (p). 16px.',
            },
            media: {
              image: 'Image element.',
              video: 'Video player. 16:9.',
              audio: 'Audio player.',
              icon: 'SVG icon. 24x24px.',
              iframe: 'Iframe embed.',
            },
            interactive: {
              button: 'Button with text child.',
              form: 'Form container.',
              input: 'Text input.',
              textarea: 'Multi-line text area.',
            },
            utility: {
              htmlEmbed: 'Custom HTML/CSS/JS code.',
            },
          },
        }, null, 2),
      }],
    }),
  );

  server.resource(
    'design-reference',
    'ycode://reference/design-properties',
    {
      description: 'Complete reference of all design property categories and allowed values',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'ycode://reference/design-properties',
        mimeType: 'application/json',
        text: JSON.stringify({
          instructions: 'Set isActive: true on any category for it to take effect.',
          categories: {
            layout: {
              display: { type: 'enum', values: ['Flex', 'block', 'inline-block', 'grid', 'hidden'] },
              flexDirection: { type: 'enum', values: ['row', 'column', 'row-reverse', 'column-reverse'] },
              justifyContent: { type: 'enum', values: ['start', 'end', 'center', 'between', 'around', 'evenly'] },
              alignItems: { type: 'enum', values: ['start', 'end', 'center', 'baseline', 'stretch'] },
              gap: { type: 'css_value', examples: ['16px', '1rem'] },
              gridTemplateColumns: { type: 'string', examples: ['1fr 1fr 1fr', 'repeat(3, 1fr)'] },
            },
            typography: {
              fontSize: { type: 'css_value', examples: ['16px', '48px'] },
              fontWeight: { type: 'string', examples: ['400', '600', '700'] },
              fontFamily: { type: 'string', examples: ['DM Sans', 'Plus Jakarta Sans'] },
              lineHeight: { type: 'css_value', examples: ['1.1', '1.5'] },
              letterSpacing: { type: 'css_value', examples: ['-0.03em', '0'] },
              textAlign: { type: 'enum', values: ['left', 'center', 'right'] },
              color: { type: 'color', examples: ['#171717', '#ffffff'] },
            },
            spacing: { padding: { type: 'css_value' }, margin: { type: 'css_value' } },
            sizing: {
              width: { type: 'css_value', examples: ['100%', 'auto'] },
              maxWidth: { type: 'css_value', examples: ['1280px'] },
              aspectRatio: { type: 'string', examples: ['16/9', '1/1'] },
            },
            borders: {
              borderRadius: { type: 'css_value', examples: ['12px', '9999px'] },
              borderWidth: { type: 'css_value' },
              borderColor: { type: 'color' },
            },
            backgrounds: {
              backgroundColor: { type: 'color', examples: ['#ffffff', '#0a0a0a'] },
            },
            effects: {
              opacity: { type: 'string' },
              boxShadow: { type: 'string' },
            },
            positioning: {
              position: { type: 'enum', values: ['relative', 'absolute', 'fixed', 'sticky'] },
              zIndex: { type: 'string' },
            },
          },
        }, null, 2),
      }],
    }),
  );

  server.resource(
    'prompts-reference',
    'ycode://reference/prompts',
    {
      description: 'Example prompts and workflows for common website-building tasks',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [{
        uri: 'ycode://reference/prompts',
        mimeType: 'application/json',
        text: JSON.stringify(EXAMPLE_PROMPTS, null, 2),
      }],
    }),
  );
}
