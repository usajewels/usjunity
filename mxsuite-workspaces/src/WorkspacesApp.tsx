import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProjectListPage from './pages/ProjectListPage';
import ProjectDetailPage from './pages/ProjectDetailPage';

export default function WorkspacesApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="projects" replace />} />
      <Route path="projects" element={<ProjectListPage />} />
      <Route path="projects/:id" element={<ProjectDetailPage />} />
    </Routes>
  );
}
