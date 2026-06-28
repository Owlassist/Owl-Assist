/* 
  Owl Assist - Minimal Clerk Custom Auth
  Focus: Email/Password only.
*/

const CLERK_PUBLISHABLE_KEY = 'pk_test_cmVzdGVkLWdvbGRmaXNoLTUyLmNsZXJrLmFjY291bnRzLmRldiQ';
const CLERK_FRONTEND_API = 'https://rested-goldfish-52.clerk.accounts.dev';

// --- Initialize Clerk ---
let clerkPromise = new Promise((resolve, reject) => {
  if (window.Clerk) {
    resolve(window.Clerk);
    return;
  }

  // Use the official global CDN which unconditionally bundles all UI components.
  const script = document.createElement('script');
  script.setAttribute('data-clerk-publishable-key', CLERK_PUBLISHABLE_KEY);
  script.crossOrigin = 'anonymous';
  script.src = `https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;

  script.onload = async () => {
    try {
      await window.Clerk.load();
      console.log('Clerk SDK loaded (Global CDN)');
      resolve(window.Clerk);
    } catch (err) {
      console.error('Clerk Initialization failed', err);
      reject(err);
    }
  };
  
  script.onerror = () => reject(new Error('Failed to load Clerk script'));
  
  document.head.appendChild(script);
});

// --- Auth Methods ---

async function signUp(email, password, username, businessName, country) {
  const clerk = await clerkPromise;

  // 1. Create the user
  const signUpAttempt = await clerk.client.signUp.create({
    emailAddress: email,
    password: password,
    username: username, // Pass username to Clerk
    unsafeMetadata: {
      business_name: businessName,
      country: country
    }
  });

  // 2. Clerk usually requires email verification. Let's trigger sending the code.
  if (signUpAttempt.status === 'missing_requirements') {
    await signUpAttempt.prepareEmailAddressVerification({ strategy: 'email_code' });
    return { status: 'needs_verification', signUpRef: signUpAttempt };
  }

  // If somehow it doesn't need verification, set active session
  if (signUpAttempt.status === 'complete') {
    await clerk.setActive({ session: signUpAttempt.createdSessionId });
    return { status: 'complete' };
  }

  return { status: signUpAttempt.status };
}

async function verifyEmail(signUpObj, code) {
  const clerk = await clerkPromise;
  
  // Submit the verification code
  const verifyAttempt = await signUpObj.attemptEmailAddressVerification({ code });

  if (verifyAttempt.status === 'complete') {
    await clerk.setActive({ session: verifyAttempt.createdSessionId });
    return { status: 'complete' };
  }

  return { status: verifyAttempt.status };
}

async function signIn(email, password) {
  const clerk = await clerkPromise;

  try {
    const signInAttempt = await clerk.client.signIn.create({
      identifier: email,
      password: password
    });

    if (signInAttempt.status === 'complete') {
      await clerk.setActive({ session: signInAttempt.createdSessionId });
      return { status: 'complete' };
    }
    return { status: signInAttempt.status, signInAttempt };
  } catch (err) {
    // If Clerk says we are already signed in, treat it as success
    if (err.errors?.[0]?.code === 'session_exists' || err.message?.includes('already signed in')) {
      return { status: 'complete' };
    }
    throw err;
  }
}

async function prepare2FA(strategy) {
  const clerk = await clerkPromise;
  const signInAttempt = clerk.client.signIn;
  
  const factor = signInAttempt.supportedSecondFactors.find(f => f.strategy === strategy);
  if (!factor) throw new Error(`Strategy ${strategy} not supported.`);
  
  const prepParams = { strategy };
  if (strategy === 'phone_code' && factor.phoneNumberId) {
    prepParams.phoneNumberId = factor.phoneNumberId;
  } else if (strategy === 'email_code' && factor.emailAddressId) {
    prepParams.emailAddressId = factor.emailAddressId;
  }
  
  await signInAttempt.prepareSecondFactor(prepParams);
}

async function verify2FA(code, strategy = 'totp') {
  const clerk = await clerkPromise;
  const signInAttempt = clerk.client.signIn;
  
  const attempt = await signInAttempt.attemptSecondFactor({
    strategy: strategy,
    code: code
  });
  
  if (attempt.status === 'complete') {
    await clerk.setActive({ session: attempt.createdSessionId });
    return { status: 'complete' };
  }
  return { status: attempt.status };
}

async function signOut() {
  const clerk = await clerkPromise;
  await clerk.signOut();
  window.location.href = '/auth/login?logout=true';
}

async function getSession() {
  const clerk = await clerkPromise;
  return clerk;
}

// --- Forgot Password ---
async function forgotPassword(email) {
  const clerk = await clerkPromise;
  // Create a sign-in attempt using the reset_password_email_code strategy
  const attempt = await clerk.client.signIn.create({
    strategy: 'reset_password_email_code',
    identifier: email
  });
  return attempt; // status will be 'needs_first_factor'
}

async function resetPassword(newPassword, code) {
  const clerk = await clerkPromise;
  // The existing signIn attempt should still be on clerk.client.signIn
  const attempt = await clerk.client.signIn.attemptFirstFactor({
    strategy: 'reset_password_email_code',
    code: code,
    password: newPassword
  });
  if (attempt.status === 'complete') {
    await clerk.setActive({ session: attempt.createdSessionId });
    return { status: 'complete' };
  }
  return { status: attempt.status };
}

// --- OAuth / Social Login ---
async function signInWithProvider(strategy) {
  const clerk = await clerkPromise;
  
  const currentOrigin = window.location.origin;

  try {
    await clerk.client.signIn.authenticateWithRedirect({
      strategy: strategy,
      redirectUrl: currentOrigin + '/auth/sso-callback',
      redirectUrlComplete: currentOrigin + '/dashboard'
    });
  } catch (err) {
    if (err.errors?.[0]?.code === 'session_exists' || err.message?.includes('already signed in')) {
      window.location.href = currentOrigin + '/dashboard';
      return;
    }
    throw err;
  }
}

async function handleCallback() {
  const clerk = await clerkPromise;
  await clerk.handleRedirectCallback({
    redirectUrlComplete: window.location.origin + '/dashboard'
  });
}

async function mountProfile(htmlElement) {
  const clerk = await clerkPromise;
  // This renders the full Clerk settings panel (Profile picture, Name, Password, Emails, etc.)
  clerk.mountUserProfile(htmlElement);
}

async function updateUsername(username) {
  const clerk = await clerkPromise;
  if (!clerk.user) throw new Error("No active user session");
  
  return await clerk.user.update({
    username: username
  });
}

async function getToken() {
  const clerk = await clerkPromise;
  return await clerk.session?.getToken();
}

// Expose these functions globally so our HTML files can use them easily
window.owlAuth = {
  signUp,
  verifyEmail,
  signIn,
  signOut,
  getSession,
  getToken,
  signInWithProvider,
  handleCallback,
  mountProfile,
  updateUsername,
  forgotPassword,
  resetPassword,
  prepare2FA,
  verify2FA
};


