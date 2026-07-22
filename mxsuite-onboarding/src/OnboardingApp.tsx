import React from 'react';
import { Routes, Route } from 'react-router-dom';
import OnboardingWizard from './pages/OnboardingWizard';

export default function OnboardingApp() {
  return (
    <Routes>
      <Route index element={<OnboardingWizard />} />
    </Routes>
  );
}
