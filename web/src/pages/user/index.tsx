import React from 'react';
import { Routes, Route } from 'react-router-dom';

import ChangePassword from './ChangePassword';
import Credits from './Credits';
import UserSettings from './UserSettings';

import Profile from '@/pages/Profile';

const UserPages: React.FC = () => {
  return (
    <Routes>
      <Route index element={<Profile />} />
      <Route path="settings" element={<UserSettings />} />
      <Route path="password" element={<ChangePassword />} />
      <Route path="credits" element={<Credits />} />
    </Routes>
  );
};

export default UserPages;
