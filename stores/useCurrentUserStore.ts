import { create } from 'zustand';

interface CurrentUserStore {
  profile: Record<string, string> | null;
  isLoading: boolean;
  error: string | null;
  fetchProfile: (previewUserId?: string | null) => Promise<void>;
}

export const useCurrentUserStore = create<CurrentUserStore>((set) => ({
  profile: null,
  isLoading: false,
  error: null,

  fetchProfile: async (previewUserId) => {
    set({ isLoading: true, error: null });
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (previewUserId) {
        headers['x-ycode-preview-user-id'] = previewUserId;
      }

      const response = await fetch('/api/auth/me', { headers });
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      set({ 
        profile: data.user?.cms_profile || null, 
        isLoading: false 
      });
    } catch (error) {
      console.error('[CurrentUserStore] Failed to fetch profile:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch profile', 
        isLoading: false 
      });
    }
  },
}));
