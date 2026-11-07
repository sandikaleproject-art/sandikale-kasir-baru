import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { seedInitialBackupData } from './seedBackup';
import { createClient } from '@supabase/supabase-js';

// 1. Polyfill / Expose React, ReactDOM, and jsPDF to window
(window as any).React = React;
(window as any).ReactDOM = { ...ReactDOM, ...ReactDOMClient };
(window as any).jspdf = { jsPDF, autoTable };
(window as any).jsPDF = jsPDF;

// SANDIKALE cloud database: only the public publishable key is used in the browser.
(window as any).supabase = { createClient };
(window as any).__SANDIKALE_SUPABASE__ = {
  url: 'https://twholneoqjifuaauztri.supabase.co',
  key: 'sb_publishable_pK9B9ONQypfkcuzrWvgT0A_w9zMAS81',
};

// 2. Initialize backup data on first boot or if local storage is missing items
seedInitialBackupData();
