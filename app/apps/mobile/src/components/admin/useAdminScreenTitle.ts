// Registers the current admin screen title in the portal TopBar (FR-ADMIN-011).
import { type ReactNode } from 'react';
import { useAdminPortalChrome } from './AdminPortalChrome';

export function useAdminScreenTitle(title: ReactNode): void {
  useAdminPortalChrome({ title });
}
