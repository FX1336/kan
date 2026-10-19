import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useState } from "react";

interface FocusLockContextProps {
  isLocked: boolean;
  setLocked: (locked: boolean) => void;
}

const FocusLockContext = createContext<FocusLockContextProps | undefined>(
  undefined,
);

export const FocusLockProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isLocked, setIsLocked] = useState(false);

  const setLocked = useCallback((locked: boolean) => {
    setIsLocked(locked);
  }, []);

  return (
    <FocusLockContext.Provider value={{ isLocked, setLocked }}>
      {children}
    </FocusLockContext.Provider>
  );
};

export const useFocusLock = (): FocusLockContextProps => {
  const context = useContext(FocusLockContext);
  if (!context) {
    throw new Error("useFocusLock must be used within a FocusLockProvider");
  }
  return context;
};
