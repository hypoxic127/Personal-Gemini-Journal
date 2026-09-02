import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  Auth,
  signInWithPopup,
  signOut as firebaseSignOut,
  onIdTokenChanged,
} from 'firebase/auth';
import { initFirebaseClient, googleProvider } from '../lib/firebase';
import { api } from '../lib/api';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  lastActiveAt: string;
  entryCount: number;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  token: string | null;
  role: 'user' | 'admin';
  isLoading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authInstance, setAuthInstance] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncUserWithBackend = async (currentUser: User) => {
    try {
      const syncResult = await api.post<UserProfile>('/api/auth/sync', {
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL,
      });
      setProfile(syncResult);
    } catch (e: any) {
      console.error('Failed to sync user with backend:', e);
    }
  };

  const refreshProfile = async () => {
    if (!user) return;
    try {
      const p = await api.get<UserProfile>('/api/auth/me');
      setProfile(p);
    } catch (e) {
      console.warn('Failed to refresh user profile:', e);
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    initFirebaseClient().then(({ auth }) => {
      setAuthInstance(auth);
      unsubscribe = onIdTokenChanged(auth, async (currentUser) => {
        setIsLoading(true);
        setAuthError(null);
        if (currentUser) {
          try {
            const idToken = await currentUser.getIdToken();
            const tokenResult = await currentUser.getIdTokenResult();
            const customRole = tokenResult.claims.role === 'admin' ? 'admin' : 'user';

            setUser(currentUser);
            setToken(idToken);
            setRole(customRole);

            await syncUserWithBackend(currentUser);
          } catch (err: any) {
            console.error('Auth state change error:', err);
            setAuthError(err.message || 'Authentication error.');
          }
        } else {
          setUser(null);
          setProfile(null);
          setToken(null);
          setRole('user');
        }
        setIsLoading(false);
      });
    }).catch((err) => {
      console.error('Failed to initialize Firebase client:', err);
      setAuthError('Failed to initialize authentication system.');
      setIsLoading(false);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    if (!authInstance) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(authInstance, googleProvider);
    } catch (err: any) {
      console.error('Google Sign-In error:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setAuthError(err.message || 'Sign in failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    if (!authInstance) return;
    setIsLoading(true);
    try {
      await firebaseSignOut(authInstance);
    } catch (err: any) {
      console.error('Sign-out error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        token,
        role,
        isLoading,
        authError,
        signInWithGoogle,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};