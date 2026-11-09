import {useContext,useLayoutEffect} from 'react';
import {ThemeContext} from '../../src/components/themeContext';
export function DemoThemeBridge(){const {setTheme}=useContext(ThemeContext);useLayoutEffect(()=>{const current=localStorage.getItem('lexicue-theme');if(current)setTheme(current as any);const apply=(event:Event)=>setTheme((event as CustomEvent).detail);window.addEventListener('lexicue-demo-theme',apply);return()=>window.removeEventListener('lexicue-demo-theme',apply);},[setTheme]);return null;}
