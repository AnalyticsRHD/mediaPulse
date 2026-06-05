export enum UserRole {
  ADMIN = 'ADMIN',
  MEDIA = 'MEDIA',
  CLIENT = 'CLIENT'
}

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};
