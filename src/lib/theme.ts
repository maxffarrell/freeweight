import { writable } from 'svelte/store';

export interface NeobrutalistTheme {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  border: string;
  shadow: string;
}

export const neobrutalistThemes: Record<string, NeobrutalistTheme> = {
  classic: {
    name: 'Classic',
    primary: '#FFFF00',     // Yellow
    secondary: '#FF69B4',   // Hot Pink
    accent: '#00FFFF',      // Cyan
    background: '#FFFFFF',   // White
    surface: '#F0F0F0',     // Light Gray
    text: '#000000',        // Black
    border: '#000000',      // Black
    shadow: '#000000'       // Black
  },
  neon: {
    name: 'Neon',
    primary: '#39FF14',     // Neon Green
    secondary: '#FF1493',   // Deep Pink
    accent: '#00BFFF',      // Deep Sky Blue
    background: '#FFFFFF',   // White
    surface: '#F5F5F5',     // White Smoke
    text: '#000000',        // Black
    border: '#000000',      // Black
    shadow: '#000000'       // Black
  },
  sunset: {
    name: 'Sunset',
    primary: '#FF4500',     // Orange Red
    secondary: '#FFD700',   // Gold
    accent: '#FF1493',      // Deep Pink
    background: '#FFFFFF',   // White
    surface: '#FFF8DC',     // Cornsilk
    text: '#000000',        // Black
    border: '#000000',      // Black
    shadow: '#000000'       // Black
  },
  ocean: {
    name: 'Ocean',
    primary: '#00CED1',     // Dark Turquoise
    secondary: '#1E90FF',   // Dodger Blue
    accent: '#FF6347',      // Tomato
    background: '#FFFFFF',   // White
    surface: '#F0F8FF',     // Alice Blue
    text: '#000000',        // Black
    border: '#000000',      // Black
    shadow: '#000000'       // Black
  },
  forest: {
    name: 'Forest',
    primary: '#32CD32',     // Lime Green
    secondary: '#228B22',   // Forest Green
    accent: '#FF4500',      // Orange Red
    background: '#FFFFFF',   // White
    surface: '#F0FFF0',     // Honeydew
    text: '#000000',        // Black
    border: '#000000',      // Black
    shadow: '#000000'       // Black
  }
};

function createThemeStore() {
  const { subscribe, set, update } = writable({
    currentTheme: neobrutalistThemes.classic,
    themeName: 'classic'
  });

  function initTheme() {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('neobrutalist-theme');
      if (savedTheme && neobrutalistThemes[savedTheme]) {
        set({
          currentTheme: neobrutalistThemes[savedTheme],
          themeName: savedTheme
        });
        applyTheme(neobrutalistThemes[savedTheme]);
      }
    }
  }

  function applyTheme(theme: NeobrutalistTheme) {
    if (typeof window !== 'undefined') {
      const root = document.documentElement;
      root.style.setProperty('--color-primary', theme.primary);
      root.style.setProperty('--color-secondary', theme.secondary);
      root.style.setProperty('--color-accent', theme.accent);
      root.style.setProperty('--color-background', theme.background);
      root.style.setProperty('--color-surface', theme.surface);
      root.style.setProperty('--color-text', theme.text);
      root.style.setProperty('--color-border', theme.border);
      root.style.setProperty('--color-shadow', theme.shadow);
    }
  }

  return {
    subscribe,
    initTheme,
    setTheme: (themeName: string) => {
      if (neobrutalistThemes[themeName]) {
        set({
          currentTheme: neobrutalistThemes[themeName],
          themeName
        });
        applyTheme(neobrutalistThemes[themeName]);
        if (typeof window !== 'undefined') {
          localStorage.setItem('neobrutalist-theme', themeName);
        }
      }
    },
    availableThemes: Object.keys(neobrutalistThemes)
  };
}

export const theme = createThemeStore();
