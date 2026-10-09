import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { themeTokens } from './theme';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: themeTokens, components: {
      Layout: { siderBg: '#ffffff', bodyBg: '#f4f6f8', headerBg: '#ffffff' },
      Menu: { itemBg: '#ffffff', itemSelectedBg: '#eaf1f7', itemSelectedColor: '#245b8f', itemHoverBg: '#f3f6f9', itemBorderRadius: 5 },
      Table: { headerBg: '#f5f7fa', headerColor: '#526173', borderColor: '#e3e8ef', rowHoverBg: '#f5f8fb' },
      Card: { borderRadiusLG: 8 },
    } }}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
