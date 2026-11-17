import React, { useEffect, useRef } from 'react';

const Layout = ({ children, onPageChange, lockMainScroll, fullWidth }) => {
  const mainRef = useRef(null);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || !lockMainScroll) return undefined;

    const preventPageWheel = (event) => event.preventDefault();
    main.addEventListener('wheel', preventPageWheel, { passive: false });
    return () => main.removeEventListener('wheel', preventPageWheel);
  }, [lockMainScroll]);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 上方標題 */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black">F</div>
          <h1 className="text-2xl font-black text-gray-800 tracking-tight">FungiGuard <span className="text-indigo-600 text-sm font-medium">真菌抗藥性分析系統</span></h1>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左側選單 */}
        <aside className="w-64 bg-white border-r border-gray-200 p-6">
          <nav className="space-y-2">
            <button 
              onClick={() => onPageChange('home')}
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-gray-100 font-medium text-gray-600 hover:text-indigo-600 transition"
            >🏠 首頁儀表板</button>
            <button 
              onClick={() => onPageChange('upload')}
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-gray-100 font-medium text-gray-600 hover:text-indigo-600 transition"
            >📤 資料上傳</button>
            <button 
              onClick={() => onPageChange('query')}
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-gray-100 font-medium text-gray-600 hover:text-indigo-600 transition"
            >🔍 序號查詢</button>
          </nav>
        </aside>

        {/* 主要內容 */}
        <main ref={mainRef} className={`min-w-0 flex-1 ${fullWidth ? '' : 'p-10'} overflow-y-auto`}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;