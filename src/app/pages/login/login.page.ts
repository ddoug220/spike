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
    if (this.isLoading) return;
    const email = this.email.trim();
    const validationError = this.getEmailFormError(email, this.password);
    if (validationError) {
      this.error = validationError;
      return;
    }

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
    if (this.isLoading) return;
    this.isLoading = true;
    this.error = null;
    try {
      await this.auth.signInWithGoogle();
      await this.router.navigate(['/home']);
    } catch (err) {
      this.error = this.parseGoogleError(err);
    } finally {
      this.isLoading = false;
    }
  }

  private getEmailFormError(email: string, password: string): string | null {
    if (!email && !password) {
      return 'Enter your email and password.';
    }
    if (!email) {
      return 'Enter your email address.';
    }
    if (!password) {
      return 'Enter your password.';
    }
    return null;
  }

  private parseFirebaseError(err: unknown): string {
    const code = this.getFirebaseErrorCode(err);
    const msg = err instanceof Error ? err.message : '';
    if (this.matchesFirebaseError(code, msg, ['invalid-credential', 'wrong-password', 'user-not-found'])) {
      return 'Incorrect email or password.';
    }
    if (this.matchesFirebaseError(code, msg, ['email-already-in-use'])) {
      return 'An account with this email already exists. Try signing in.';
    }
    if (this.matchesFirebaseError(code, msg, ['weak-password'])) {
      return 'Password must be at least 6 characters.';
    }
    if (this.matchesFirebaseError(code, msg, ['invalid-email'])) {
      return 'Enter a valid email address.';
    }
    if (this.matchesFirebaseError(code, msg, ['too-many-requests'])) {
      return 'Too many attempts. Please wait and try again.';
    }
    if (this.matchesFirebaseError(code, msg, ['network-request-failed'])) {
      return 'Network connection failed. Check your connection and try again.';
    }
    if (this.matchesFirebaseError(code, msg, ['operation-not-allowed'])) {
      return 'Email sign-in is not enabled for this app.';
    }
    return 'Something went wrong. Please try again.';
  }

  private parseGoogleError(err: unknown): string {
    const code = this.getFirebaseErrorCode(err);
    const msg = err instanceof Error ? err.message : '';
    if (this.matchesFirebaseError(code, msg, ['popup-closed-by-user', 'cancelled-popup-request'])) {
      return 'Google sign-in was cancelled before it finished.';
    }
    if (this.matchesFirebaseError(code, msg, ['popup-blocked'])) {
      return 'Your browser blocked the Google sign-in pop-up. Allow pop-ups and try again.';
    }
    if (this.matchesFirebaseError(code, msg, ['unauthorized-domain'])) {
      return 'Google sign-in is not authorized for this domain.';
    }
    if (this.matchesFirebaseError(code, msg, ['operation-not-allowed'])) {
      return 'Google sign-in is not enabled for this app.';
    }
    if (this.matchesFirebaseError(code, msg, ['network-request-failed'])) {
      return 'Network connection failed. Check your connection and try Google again.';
    }
    if (this.matchesFirebaseError(code, msg, ['account-exists-with-different-credential'])) {
      return 'An account already exists with this email. Sign in with your original method.';
    }
    return 'Google sign-in failed. Please try again.';
  }

  private getFirebaseErrorCode(err: unknown): string {
    if (typeof err !== 'object' || err === null || !('code' in err)) {
      return '';
    }
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : '';
  }

  private matchesFirebaseError(code: string, message: string, fragments: string[]): boolean {
    return fragments.some((fragment) => code === `auth/${fragment}` || code === fragment || message.includes(fragment));
  }
}
