import {initializeApp,applicationDefault,cert} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {getAppCheck} from 'firebase-admin/app-check';

const credentials=process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp({credential:credentials?cert(JSON.parse(credentials)):applicationDefault(),projectId:'finoraaaaaa'});
export const db=getFirestore();
export const auth=getAuth();
export const appCheck=getAppCheck();
export function need(key:string){const v=process.env[key];if(!v) throw Error('Missing '+key); return v}
