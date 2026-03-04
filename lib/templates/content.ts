/**
 * Content Elements Templates
 */

import { BlockTemplate } from '@/types';
import { getTiptapTextContent } from '@/lib/text-format-utils';

export const contentTemplates: Record<string, BlockTemplate> = {
  heading: {
    icon: 'heading',
    name: 'Heading',
    template: {
      name: 'text',
      settings: {
        tag: 'h1',
      },
      classes: ['text-[48px]', 'font-[700]', 'leading-[1.1]', 'tracking-[-0.01em]'],
      restrictions: { editText: true },
      design: {
        typography: {
          isActive: true,
          fontSize: '48px',
          fontWeight: '700',
          lineHeight: '1.1',
          letterSpacing: '-0.01',
        }
      },
      variables: {
        text: {
          type: 'dynamic_rich_text',
          data: {
            content: getTiptapTextContent('Heading')
          }
        }
      }
    }
  },

  text: {
    icon: 'text',
    name: 'Text',
    template: {
      name: 'text',
      settings: {
        tag: 'p',
      },
      classes: ['text-[16px]'],
      restrictions: { editText: true },
      design: {
        typography: {
          isActive: true,
          fontSize: '16px',
        }
      },
      variables: {
        text: {
          type: 'dynamic_rich_text',
          data: {
            content: getTiptapTextContent('Text')
          }
        }
      }
    }
  },

  richText: {
    icon: 'rich-text',
    name: 'Rich Text',
    template: {
      name: 'richText',
      settings: {
        tag: 'div',
      },
      classes: ['text-[16px]'],
      restrictions: { editText: true },
      design: {
        typography: {
          isActive: true,
          fontSize: '16px',
        }
      },
      textStyles: {
        h1: {
          label: 'Heading 1',
          classes: 'block text-[40px] font-bold leading-[1.2] tracking-[-0.02em] mt-[32px] mb-[16px]',
          design: {
            layout: { display: 'block' },
            typography: { fontSize: '40px', fontWeight: 'bold', lineHeight: '1.2', letterSpacing: '-0.02em' },
            spacing: { marginTop: '32px', marginBottom: '16px' },
          },
        },
        h2: {
          label: 'Heading 2',
          classes: 'block text-[32px] font-bold leading-[1.25] tracking-[-0.02em] mt-[28px] mb-[12px]',
          design: {
            layout: { display: 'block' },
            typography: { fontSize: '32px', fontWeight: 'bold', lineHeight: '1.25', letterSpacing: '-0.02em' },
            spacing: { marginTop: '28px', marginBottom: '12px' },
          },
        },
        h3: {
          label: 'Heading 3',
          classes: 'block text-[24px] font-semibold leading-[1.3] mt-[24px] mb-[8px]',
          design: {
            layout: { display: 'block' },
            typography: { fontSize: '24px', fontWeight: 'semibold', lineHeight: '1.3' },
            spacing: { marginTop: '24px', marginBottom: '8px' },
          },
        },
        h4: {
          label: 'Heading 4',
          classes: 'block text-[20px] font-semibold leading-[1.4] mt-[20px] mb-[8px]',
          design: {
            layout: { display: 'block' },
            typography: { fontSize: '20px', fontWeight: 'semibold', lineHeight: '1.4' },
            spacing: { marginTop: '20px', marginBottom: '8px' },
          },
        },
        h5: {
          label: 'Heading 5',
          classes: 'block text-[18px] font-semibold leading-[1.4] mt-[16px] mb-[4px]',
          design: {
            layout: { display: 'block' },
            typography: { fontSize: '18px', fontWeight: 'semibold', lineHeight: '1.4' },
            spacing: { marginTop: '16px', marginBottom: '4px' },
          },
        },
        h6: {
          label: 'Heading 6',
          classes: 'block text-[16px] font-semibold leading-[1.4] mt-[16px] mb-[4px]',
          design: {
            layout: { display: 'block' },
            typography: { fontSize: '16px', fontWeight: 'semibold', lineHeight: '1.4' },
            spacing: { marginTop: '16px', marginBottom: '4px' },
          },
        },
        paragraph: {
          label: 'Paragraph',
          classes: 'block mb-[16px] leading-[1.7]',
          design: {
            layout: { display: 'block' },
            typography: { lineHeight: '1.7' },
            spacing: { marginBottom: '16px' },
          },
        },
        bold: {
          label: 'Bold',
          classes: 'font-bold',
          design: { typography: { fontWeight: 'bold' } },
        },
        italic: {
          label: 'Italic',
          classes: 'italic',
          design: { typography: { fontStyle: 'italic' } },
        },
        underline: {
          label: 'Underline',
          classes: 'underline',
          design: { typography: { textDecoration: 'underline' } },
        },
        strike: {
          label: 'Strikethrough',
          classes: 'line-through',
          design: { typography: { textDecoration: 'line-through' } },
        },
        subscript: {
          label: 'Subscript',
          classes: 'align-sub',
          design: { typography: { verticalAlign: 'sub' } },
        },
        superscript: {
          label: 'Superscript',
          classes: 'align-super',
          design: { typography: { verticalAlign: 'super' } },
        },
        code: {
          label: 'Code',
          classes: 'font-mono bg-muted px-[4px] py-[2px] rounded text-[14px]',
          design: {
            typography: { fontFamily: 'mono', fontSize: '14px' },
            backgrounds: { backgroundColor: 'muted' },
            spacing: { paddingLeft: '4px', paddingRight: '4px', paddingTop: '2px', paddingBottom: '2px' },
            borders: { borderRadius: 'rounded' },
          },
        },
        link: {
          label: 'Link',
          classes: 'text-[#1c70d7] underline underline-offset-2',
          design: { typography: { textDecoration: 'underline', color: '#1c70d7' } },
        },
        bulletList: {
          label: 'Bullet List',
          classes: 'ml-[8px] pl-[16px] mb-[16px] list-disc',
          design: { spacing: { marginLeft: '8px', paddingLeft: '16px', marginBottom: '16px' } },
        },
        orderedList: {
          label: 'Ordered List',
          classes: 'ml-[8px] pl-[20px] mb-[16px] list-decimal',
          design: { spacing: { marginLeft: '8px', paddingLeft: '20px', marginBottom: '16px' } },
        },
        listItem: {
          label: 'List Item',
          classes: '',
        },
      },
      variables: {
        text: {
          type: 'dynamic_rich_text',
          data: {
            content: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Rich Text Element' }],
                },
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Double-click to edit this element. Rich Text is great for long form content like articles, blog posts, and product descriptions.' },
                  ],
                },
                {
                  type: 'heading',
                  attrs: { level: 3 },
                  content: [{ type: 'text', text: 'Styling content' }],
                },
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Each inner element — headings, paragraphs, lists, and links — can be styled individually using the ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Text Style' },
                    { type: 'text', text: ' selector in the design panel.' },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  },
};
