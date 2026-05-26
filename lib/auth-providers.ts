/**
 * Official Auth Provider Configurations
 * 
 * Defines brand-compliant styling and UI requirements for social login buttons.
 */

export interface AuthProviderConfig {
  id: string;
  name: string;
  buttonText: string;
  iconName: string;
  styling: {
    backgroundColor: string;
    textColor: string;
    borderColor: string;
    hoverBackgroundColor: string;
    activeBackgroundColor: string;
    borderRadius?: string;
    fontSize?: string;
    fontWeight?: string;
    gap?: string;
    padding?: string;
  };
}

export const AUTH_PROVIDERS: Record<string, AuthProviderConfig> = {
  google: {
    id: 'google',
    name: 'Google',
    buttonText: 'Sign in with Google',
    iconName: 'google',
    styling: {
      backgroundColor: '#FFFFFF',
      textColor: '#3c4043',
      borderColor: '#dadce0',
      hoverBackgroundColor: '#f8f9fa',
      activeBackgroundColor: '#eeeeee',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: '500',
      gap: '12px',
      padding: '0 12px',
    }
  },
  github: {
    id: 'github',
    name: 'GitHub',
    buttonText: 'Continue with GitHub',
    iconName: 'github',
    styling: {
      backgroundColor: '#24292e',
      textColor: '#ffffff',
      borderColor: 'transparent',
      hoverBackgroundColor: '#2c3238',
      activeBackgroundColor: '#1b1f23',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '600',
      gap: '8px',
      padding: '0 16px',
    }
  }
};
