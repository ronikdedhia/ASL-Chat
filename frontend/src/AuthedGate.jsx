import { SignedIn, SignedOut, SignIn, useAuth, useUser } from '@clerk/clerk-react';
import App from './App.jsx';

// Only mounted when VITE_CLERK_PUBLISHABLE_KEY is set — see main.jsx. Splitting this into
// its own component (rather than branching inside App.jsx) means App.jsx never calls a
// Clerk hook unless it's actually rendered inside a <ClerkProvider>, which throws otherwise.
export default function AuthedGate() {
  return (
    <>
      <SignedOut>
        <div className="join-screen">
          <div className="join-card">
            <h1>ASL-Chat</h1>
            <p className="join-subtitle">Sign in to start chatting.</p>
            <SignIn routing="hash" />
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
