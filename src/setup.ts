import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { seedInitialBackupData } from './seedBackup';

// 1. Polyfill / Expose React, ReactDOM, and jsPDF to window
(window as any).React = React;
(window as any).ReactDOM = { ...ReactDOM, ...ReactDOMClient };
(window as any).jspdf = { jsPDF, autoTable };
(window as any).jsPDF = jsPDF;

// 2. Initialize backup data on first boot or if local storage is missing items
seedInitialBackupData();
