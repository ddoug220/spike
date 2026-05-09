import { NgClass } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';

type AuthMode = 'signin' | 'signup';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [IonContent, NgClass, FormsModule],
})
export class LoginPage {
  mode: AuthMode = 'signin';
  email = '';
  password = '';
  showPassword = false;
  isLoading = false;
  error: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  setMode(next: AuthMode): void {
    this.mode = next;
    this.error = null;
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submitEmail(): Promise<void> {
    const email = this.email.trim();
    if (!email || !this.password) return;
    this.isLoading = true;
    this.error = null;
    try {
      if (this.mode === 'signin') {
        await this.auth.signInWithEmailPassword(email, this.password);
      } else {
        await this.auth.createUserWithEmailPassword(email, this.password);
      }
      await this.router.navigate(['/home']);
    } catch (err) {
      this.error = this.parseFirebaseError(err);
    } finally {
      this.isLoading = false;
    }
  }

  async continueWithGoogle(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    try {
      await this.auth.signInWithGoogle();
      await this.router.navigate(['/home']);
    } catch {
      this.error = 'Google sign-in failed. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private parseFirebaseError(err: unknown): string {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
      return 'Incorrect email or password.';
    }
    if (msg.includes('email-already-in-use')) {
      return 'An account with this email already exists. Try signing in.';
    }
    if (msg.includes('weak-password')) {
      return 'Password must be at least 6 characters.';
    }
    if (msg.includes('invalid-email')) {
      return 'Enter a valid email address.';
    }
    if (msg.includes('too-many-requests')) {
      return 'Too many attempts. Please wait and try again.';
    }
    return 'Something went wrong. Please try again.';
  }
}
