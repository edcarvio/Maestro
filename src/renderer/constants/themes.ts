import type { Theme, ThemeId } from '../types';

export const THEMES: Record<ThemeId, Theme> = {
  // Dark themes
  dracula: {
    id: 'dracula',
    name: 'Dracula',
    mode: 'dark',
    colors: {
      bgMain: '#0b0b0d',
      bgSidebar: '#111113',
      bgActivity: '#1c1c1f',
      border: '#27272a',
      textMain: '#e4e4e7',
      textDim: '#a1a1aa',
      accent: '#6366f1',
      accentDim: 'rgba(99, 102, 241, 0.2)',
      accentText: '#a5b4fc',
      success: '#22c55e',
      warning: '#eab308',
      error: '#ef4444'
    }
  },
  monokai: {
    id: 'monokai',
    name: 'Monokai',
    mode: 'dark',
    colors: {
      bgMain: '#272822',
      bgSidebar: '#1e1f1c',
      bgActivity: '#3e3d32',
      border: '#49483e',
      textMain: '#f8f8f2',
      textDim: '#8f908a',
      accent: '#fd971f',
      accentDim: 'rgba(253, 151, 31, 0.2)',
      accentText: '#fdbf6f',
      success: '#a6e22e',
      warning: '#e6db74',
      error: '#f92672'
    }
  },
  nord: {
    id: 'nord',
    name: 'Nord',
    mode: 'dark',
    colors: {
      bgMain: '#2e3440',
      bgSidebar: '#3b4252',
      bgActivity: '#434c5e',
      border: '#4c566a',
      textMain: '#eceff4',
      textDim: '#d8dee9',
      accent: '#88c0d0',
      accentDim: 'rgba(136, 192, 208, 0.2)',
      accentText: '#8fbcbb',
      success: '#a3be8c',
      warning: '#ebcb8b',
      error: '#bf616a'
    }
  },
  'tokyo-night': {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    mode: 'dark',
    colors: {
      bgMain: '#1a1b26',
      bgSidebar: '#16161e',
      bgActivity: '#24283b',
      border: '#414868',
      textMain: '#c0caf5',
      textDim: '#9aa5ce',
      accent: '#7aa2f7',
      accentDim: 'rgba(122, 162, 247, 0.2)',
      accentText: '#7dcfff',
      success: '#9ece6a',
      warning: '#e0af68',
      error: '#f7768e'
    }
  },
  'catppuccin-mocha': {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    mode: 'dark',
    colors: {
      bgMain: '#1e1e2e',
      bgSidebar: '#181825',
      bgActivity: '#313244',
      border: '#45475a',
      textMain: '#cdd6f4',
      textDim: '#bac2de',
      accent: '#89b4fa',
      accentDim: 'rgba(137, 180, 250, 0.2)',
      accentText: '#89dceb',
      success: '#a6e3a1',
      warning: '#f9e2af',
      error: '#f38ba8'
    }
  },
  'gruvbox-dark': {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    mode: 'dark',
    colors: {
      bgMain: '#282828',
      bgSidebar: '#1d2021',
      bgActivity: '#3c3836',
      border: '#504945',
      textMain: '#ebdbb2',
      textDim: '#a89984',
      accent: '#83a598',
      accentDim: 'rgba(131, 165, 152, 0.2)',
      accentText: '#8ec07c',
      success: '#b8bb26',
      warning: '#fabd2f',
      error: '#fb4934'
    }
  },
  // Light themes
  'github-light': {
    id: 'github-light',
    name: 'GitHub',
    mode: 'light',
    colors: {
      bgMain: '#ffffff',
      bgSidebar: '#f6f8fa',
      bgActivity: '#eff2f5',
      border: '#d0d7de',
      textMain: '#24292f',
      textDim: '#57606a',
      accent: '#0969da',
      accentDim: 'rgba(9, 105, 218, 0.1)',
      accentText: '#0969da',
      success: '#1a7f37',
      warning: '#9a6700',
      error: '#cf222e'
    }
  },
  'solarized-light': {
    id: 'solarized-light',
    name: 'Solarized',
    mode: 'light',
    colors: {
      bgMain: '#fdf6e3',
      bgSidebar: '#eee8d5',
      bgActivity: '#e6dfc8',
      border: '#d3cbb7',
      textMain: '#657b83',
      textDim: '#93a1a1',
      accent: '#2aa198',
      accentDim: 'rgba(42, 161, 152, 0.1)',
      accentText: '#2aa198',
      success: '#859900',
      warning: '#b58900',
      error: '#dc322f'
    }
  },
  'one-light': {
    id: 'one-light',
    name: 'One Light',
    mode: 'light',
    colors: {
      bgMain: '#fafafa',
      bgSidebar: '#f0f0f0',
      bgActivity: '#e5e5e6',
      border: '#d0d0d0',
      textMain: '#383a42',
      textDim: '#a0a1a7',
      accent: '#4078f2',
      accentDim: 'rgba(64, 120, 242, 0.1)',
      accentText: '#4078f2',
      success: '#50a14f',
      warning: '#c18401',
      error: '#e45649'
    }
  },
  'gruvbox-light': {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    mode: 'light',
    colors: {
      bgMain: '#fbf1c7',
      bgSidebar: '#ebdbb2',
      bgActivity: '#d5c4a1',
      border: '#bdae93',
      textMain: '#3c3836',
      textDim: '#7c6f64',
      accent: '#458588',
      accentDim: 'rgba(69, 133, 136, 0.1)',
      accentText: '#076678',
      success: '#98971a',
      warning: '#d79921',
      error: '#cc241d'
    }
  },
  'catppuccin-latte': {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    mode: 'light',
    colors: {
      bgMain: '#eff1f5',
      bgSidebar: '#e6e9ef',
      bgActivity: '#dce0e8',
      border: '#bcc0cc',
      textMain: '#4c4f69',
      textDim: '#5c5f77',
      accent: '#1e66f5',
      accentDim: 'rgba(30, 102, 245, 0.1)',
      accentText: '#1e66f5',
      success: '#40a02b',
      warning: '#df8e1d',
      error: '#d20f39'
    }
  },
  'ayu-light': {
    id: 'ayu-light',
    name: 'Ayu Light',
    mode: 'light',
    colors: {
      bgMain: '#fafafa',
      bgSidebar: '#f3f4f5',
      bgActivity: '#e7e8e9',
      border: '#d9d9d9',
      textMain: '#5c6166',
      textDim: '#828c99',
      accent: '#55b4d4',
      accentDim: 'rgba(85, 180, 212, 0.1)',
      accentText: '#399ee6',
      success: '#86b300',
      warning: '#f2ae49',
      error: '#f07171'
    }
  }
};
