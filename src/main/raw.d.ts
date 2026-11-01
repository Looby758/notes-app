// Files imported as text by Vite.
declare module '*?raw' {
  const text: string
  export default text
}

// A worker thread's script, built as a file of its own by electron-vite; this is its path.
declare module '*?modulePath' {
  const path: string
  export default path
}
