import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const ThemeContext = createContext();
const DEFAULT_COLOR_THEME = 'violet';
const COLOR_THEME_IDS = new Set(['violet', 'ocean', 'emerald', 'sunset', 'rose']);

// The provider and its colocated hook intentionally share this small module.
// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const { user, loading } = useAuth();
  const appearanceKey = user?.accountId ? `budget:appearance:${user.accountId}` : null;
  const [appearance, setAppearance] = useState({ ownerKey: null, isDarkMode: false, colorTheme: DEFAULT_COLOR_THEME });

  useEffect(() => {
    if (loading) return;
    let saved = null;
    if (appearanceKey) {
      try { saved = JSON.parse(localStorage.getItem(appearanceKey)); } catch { saved = null; }
    }
    setAppearance({
      ownerKey: appearanceKey,
      isDarkMode: typeof saved?.isDarkMode === 'boolean' ? saved.isDarkMode : false,
      colorTheme: COLOR_THEME_IDS.has(saved?.colorTheme) ? saved.colorTheme : DEFAULT_COLOR_THEME,
    });
  }, [appearanceKey, loading]);

  const { isDarkMode, colorTheme } = appearance;

  useEffect(() => {
    if (appearance.ownerKey === appearanceKey && appearanceKey) localStorage.setItem(appearanceKey, JSON.stringify({ isDarkMode, colorTheme }));
    document.documentElement.dataset.themeMode = isDarkMode ? 'dark' : 'light';
    
    // Remove existing theme stylesheets
    const existingTheme = document.getElementById('dynamic-theme');
    if (existingTheme) existingTheme.remove();

    // Only add dark theme if dark mode is enabled
    if (isDarkMode) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.id = 'dynamic-theme';
      link.href = '/App-dark.css';
      document.head.appendChild(link);
    }
  }, [appearance.ownerKey, appearanceKey, colorTheme, isDarkMode]);

  useEffect(() => {
    document.documentElement.dataset.colorTheme = colorTheme;
  }, [colorTheme]);

  const toggleTheme = () => {
    setAppearance(current => ({ ...current, isDarkMode: !current.isDarkMode }));
  };

  const setColorTheme = (themeId) => {
    if (COLOR_THEME_IDS.has(themeId)) setAppearance(current => ({ ...current, colorTheme: themeId }));
  };

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme, colorTheme, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
