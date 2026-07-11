import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Clerk is optional — same "runs without it, in a reduced mode" pattern as the backend.
// Without a publishable key, App renders directly in open mode (free-text display name,
// no real accounts). With one, ClerkProvider + AuthedGate gate the app behind sign-in.
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

async function render() {
  const root = ReactDOM.createRoot(document.getElementById('root'));

  if (!clerkPublishableKey) {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    return;
  }

  const [{ ClerkProvider }, { default: AuthedGate }] = await Promise.all([
    import('@clerk/clerk-react'),
    import('./AuthedGate.jsx'),
  ]);

  root.render(
    <React.StrictMode>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <AuthedGate />
      </ClerkProvider>
    </React.StrictMode>,
  );
}

render();
