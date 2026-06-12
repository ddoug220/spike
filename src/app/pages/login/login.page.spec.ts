import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;
  let auth: jasmine.SpyObj<Pick<AuthService, 'signInWithEmailPassword' | 'createUserWithEmailPassword' | 'signInWithGoogle'>>;
  let router: jasmine.SpyObj<Pick<Router, 'navigate'>>;

  beforeEach(async () => {
    auth = jasmine.createSpyObj('AuthService', [
      'signInWithEmailPassword',
      'createUserWithEmailPassword',
      'signInWithGoogle',
    ]);
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows a validation error instead of silently ignoring a blank email submit', async () => {
    await component.submitEmail();
    fixture.detectChanges();

    expect(auth.signInWithEmailPassword).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Enter your email and password.');
  });

  it('surfaces Firebase email sign-in errors from error codes', async () => {
    auth.signInWithEmailPassword.and.rejectWith({ code: 'auth/invalid-credential' });
    component.email = 'new@example.com';
    component.password = 'bad-password';

    await component.submitEmail();
    fixture.detectChanges();

    expect(auth.signInWithEmailPassword).toHaveBeenCalledOnceWith('new@example.com', 'bad-password');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Incorrect email or password.');
  });

  it('surfaces Firebase Google sign-in errors from error codes', async () => {
    auth.signInWithGoogle.and.rejectWith({ code: 'auth/popup-blocked' });

    await component.continueWithGoogle();
    fixture.detectChanges();

    expect(auth.signInWithGoogle).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Your browser blocked the Google sign-in pop-up.');
  });

  it('navigates home after a successful email sign-in', async () => {
    auth.signInWithEmailPassword.and.resolveTo();
    component.email = ' new@example.com ';
    component.password = 'password123';

    await component.submitEmail();

    expect(auth.signInWithEmailPassword).toHaveBeenCalledOnceWith('new@example.com', 'password123');
    expect(router.navigate).toHaveBeenCalledOnceWith(['/home']);
  });
});
