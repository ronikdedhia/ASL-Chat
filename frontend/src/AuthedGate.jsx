import { SignedIn, SignedOut, SignIn, useAuth, useUser } from '@clerk/clerk-react';
import { dark } from '@clerk/themes';
import App from './App.jsx';

// Clerk's <SignIn/> defaults to its own light theme regardless of the host page — left
// unthemed it renders as a stark white card floating in this app's dark shell. The `dark`
// preset plus `variables` here match the app's existing palette (#0f172a page / #1e293b
// card / #6366f1 accent, see index.css's .join-card) so it reads as part of the app, not
// a third-party popup dropped on top of it.
const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: '#6366f1',
    colorBackground: '#1e293b',
    colorInputBackground: '#0f172a',
    colorInputText: '#e2e8f0',
    colorText: '#e2e8f0',
    colorTextSecondary: '#94a3b8',
    borderRadius: '12px',
  },
};

// Only mounted when VITE_CLERK_PUBLISHABLE_KEY is set — see main.jsx. Splitting this into
// its own component (rather than branching inside App.jsx) means App.jsx never calls a
// Clerk hook unless it's actually rendered inside a <ClerkProvider>, which throws otherwise.
export default function AuthedGate() {
  return (
    <>
      <SignedOut>
        <div className="join-screen">
          <div className="clerk-sign-in-wrapper">
            <SignIn routing="hash" appearance={clerkAppearance} />
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        <ClerkIdentityApp />
      </SignedIn>
    </>
  );
}

function ClerkIdentityApp() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const displayName = user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || 'User';
  return <App fixedDisplayName={displayName} getAuthToken={getToken} myUserId={user?.id} />;
}
