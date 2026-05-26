/**
 * Authentication System Templates
 */

import { BlockTemplate } from '@/types';
import { getTemplateRef } from '@/lib/templates/blocks';
import { getTiptapTextContent } from '@/lib/text-format-utils';

export const authTemplates: Record<string, BlockTemplate> = {
  login_form: {
    icon: 'form',
    name: 'Login Form',
    template: {
      name: 'auth_form',
      customName: 'Login Form',
      classes: ['flex', 'flex-col', 'gap-6', 'w-full', 'max-w-md'],
      settings: {
        id: 'login-form',
        auth: { type: 'login' }
      } as any,
      children: [
        {
          name: 'div',
          settings: { tag: 'label' },
          classes: ['flex', 'flex-col', 'gap-1'],
          children: [
            getTemplateRef('text', {
              customName: 'Label',
              variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('Email') } } }
            }),
            {
              name: 'input',
              attributes: { type: 'email', name: 'email', required: true, placeholder: 'Email address' },
              classes: ['w-full', 'h-10', 'px-3', 'rounded-md', 'border', 'bg-background'],
            }
          ]
        },
        {
          name: 'div',
          settings: { tag: 'label' },
          classes: ['flex', 'flex-col', 'gap-1'],
          children: [
            getTemplateRef('text', {
              customName: 'Label',
              variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('Password') } } }
            }),
            {
              name: 'input',
              attributes: { type: 'password', name: 'password', required: true, placeholder: 'Password' },
              classes: ['w-full', 'h-10', 'px-3', 'rounded-md', 'border', 'bg-background'],
            }
          ]
        },
        {
          name: 'button',
          classes: ['w-full', 'h-10', 'bg-primary', 'text-primary-foreground', 'rounded-md', 'font-medium'],
          attributes: { type: 'submit' },
          children: [
            getTemplateRef('text', {
              variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('Log in') } } }
            })
          ]
        }
      ]
    }
  },

  register_form: {
    icon: 'form',
    name: 'Registration Form',
    template: {
      name: 'auth_form',
      customName: 'Registration Form',
      classes: ['flex', 'flex-col', 'gap-6', 'w-full', 'max-w-md'],
      settings: {
        id: 'register-form',
        auth: { type: 'register' }
      } as any,
      children: [
        {
          name: 'div',
          settings: { tag: 'label' },
          classes: ['flex', 'flex-col', 'gap-1'],
          children: [
            getTemplateRef('text', {
              customName: 'Label',
              variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('Full name') } } }
            }),
            {
              name: 'input',
              attributes: { type: 'text', name: 'full_name', required: true, placeholder: 'John Doe' },
              classes: ['w-full', 'h-10', 'px-3', 'rounded-md', 'border', 'bg-background'],
            }
          ]
        },
        {
          name: 'div',
          settings: { tag: 'label' },
          classes: ['flex', 'flex-col', 'gap-1'],
          children: [
            getTemplateRef('text', {
              customName: 'Label',
              variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('Email') } } }
            }),
            {
              name: 'input',
              attributes: { type: 'email', name: 'email', required: true, placeholder: 'Email address' },
              classes: ['w-full', 'h-10', 'px-3', 'rounded-md', 'border', 'bg-background'],
            }
          ]
        },
        {
          name: 'div',
          settings: { tag: 'label' },
          classes: ['flex', 'flex-col', 'gap-1'],
          children: [
            getTemplateRef('text', {
              customName: 'Label',
              variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('Password') } } }
            }),
            {
              name: 'input',
              attributes: { type: 'password', name: 'password', required: true, placeholder: 'Create a password' },
              classes: ['w-full', 'h-10', 'px-3', 'rounded-md', 'border', 'bg-background'],
            }
          ]
        },
        {
          name: 'button',
          classes: ['w-full', 'h-10', 'bg-primary', 'text-primary-foreground', 'rounded-md', 'font-medium'],
          attributes: { type: 'submit' },
          children: [
            getTemplateRef('text', {
              variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('Create account') } } }
            })
          ]
        }
      ]
    }
  },

  user_status: {
    icon: 'user',
    name: 'User Status',
    template: {
      name: 'user_status',
      customName: 'User Status',
      classes: ['flex', 'items-center'],
      settings: {
        auth: {
          loginUrl: '/login',
          profileLinks: [
            { label: 'My Profile', url: '/profile' }
          ]
        }
      } as any
    }
  },

  social_login: {
    icon: 'google',
    name: 'Google Login',
    template: {
      name: 'button',
      customName: 'Google Login',
      classes: [
        'flex', 'items-center', 'justify-center', 'gap-3', 
        'w-full', 'h-10', 'px-4',
        'border', 'border-[#dadce0]', 'rounded', 
        'bg-white', 'text-[#3c4043]', 
        'text-sm', 'font-medium', 'font-sans',
        'hover:bg-[#f8f9fa]', 'hover:border-[#d2d4d7]',
        'active:bg-[#eeeeee]',
        'transition-colors', 'duration-200'
      ],
      settings: { auth: { type: 'social', provider: 'google' } } as any,
      children: [
        {
          name: 'icon',
          variables: { icon: { src: { type: 'static_text', data: { content: 'google' } } } } as any,
          classes: ['size-[18px]'],
        },
        getTemplateRef('text', {
          variables: { text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent('Sign in with Google') } } }
        })
      ]
    }
  }
};
