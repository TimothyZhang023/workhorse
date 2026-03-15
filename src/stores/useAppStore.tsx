import React, { createContext, useContext, ReactNode } from "react";

/**
 * Global app state — replaces UmiJS `useModel('global')`.
 * Since this is a desktop-only app in standalone mode, the user is always
 * the local admin user and considered "logged in".
 */

interface AppState {
  currentUser: API.CurrentUser;
  isLoggedIn: boolean;
  login: (user: API.CurrentUser, token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const defaultState: AppState = {
  currentUser: { username: "牛马", role: "admin", uid: "local" },
  isLoggedIn: true,
  login: async () => { },
  logout: async () => { },
};

export const AppStoreContext = createContext<AppState>(defaultState);

export const AppStoreProvider = ({ children }: { children: ReactNode }) => {
  return (
    <AppStoreContext.Provider value={defaultState}>
      {children}
    </AppStoreContext.Provider>
  );
};

/**
 * Drop-in replacement for `useModel('global')` across all pages.
 * Usage: `const { currentUser, isLoggedIn } = useAppStore();`
 */
export const useAppStore = () => {
  const context = useContext(AppStoreContext);
  return context || defaultState;
};
