import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { del, get, set } from "idb-keyval";

type DashboardStore = {
  selectedChatLabel: string;
  selectChat: (label: string) => void;
};

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set) => ({
      selectedChatLabel: "StyleX migration notes",
      selectChat: (label) => set({ selectedChatLabel: label }),
    }),
    {
      name: "@open-insight/dashboard storage",
      storage: createJSONStorage(() => ({
        getItem: async (name: string): Promise<string | null> => {
          const value = await get<string>(name);
          return value ?? null;
        },
        setItem: async (name: string, value: string): Promise<void> => {
          await set(name, value);
        },
        removeItem: async (name: string): Promise<void> => {
          await del(name);
        },
      })),
    },
  ),
);
