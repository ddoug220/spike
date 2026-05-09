import { Injectable, signal } from '@angular/core';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private static readonly appName = 'spike-firebase';
  private readonly auth: Auth;
  private readonly userSignal = signal<User | null | undefined>(undefined);

  readonly user = this.userSignal.asReadonly();

  constructor() {
    const app: FirebaseApp =
      getApps().find((a) => a.name === AuthService.appName) ??
      initializeApp(environment.firebase, AuthService.appName);
    this.auth = getAuth(app);
    onAuthStateChanged(this.auth, (user) => this.userSignal.set(user));
  }

  get uid(): string | null {
    const u = this.userSignal();
    return u == null ? null : u.uid;
  }

  get displayName(): string | null {
    return this.userSignal()?.displayName ?? null;
  }

  get email(): string | null {
    return this.userSignal()?.email ?? null;
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(this.auth, provider);
  }

  async signInWithEmailPassword(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  async createUserWithEmailPassword(email: string, password: string): Promise<void> {
    await createUserWithEmailAndPassword(this.auth, email, password);
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
  }
}
