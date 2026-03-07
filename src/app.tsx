import { history, RequestConfig, RunTimeLayoutConfig } from "@umijs/max";
import { getCurrentUser } from "./services/api";

export async function getInitialState(): Promise<{
  currentUser?: API.CurrentUser | null;
  fetchUserInfo?: () => Promise<API.CurrentUser | undefined>;
}> {
  const fetchUserInfo = async () => {
    try {
      const token = localStorage.getItem("token");
      if (token) {
        return await getCurrentUser();
      }
    } catch (error) {
      localStorage.removeItem("token");
    }
    return undefined;
  };

  const currentUser = await fetchUserInfo();
  return {
    currentUser,
    fetchUserInfo,
  };
}

export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => {
  return {
    logo: null,
    menu: {
      locale: false,
    },
    layout: "top",
    contentStyle: {
      padding: 0,
      margin: 0,
      height: "100vh",
    },
    // We handle layout manually in Chat page, so we might want to hide default layout elements or just use it as a shell
    // Actually, for this specific app (Chat interface), we might not want the default ProLayout chrome (sidebar/header)
    // because we implemented our own Sidebar in Chat page.
    // However, Umi Max forces a layout unless we set `layout: false` in routes.
    // In .umirc.ts we set layout: false for /chat and /login, so this config mainly affects other pages if any.
    logout: () => {
      localStorage.removeItem("token");
      setInitialState((s) => ({ ...s, currentUser: undefined }));
      history.push("/login");
    },
  };
};

export const request: RequestConfig = {
  timeout: 10000,
  errorConfig: {
    errorHandler: () => {
      // Custom error handling
    },
    errorThrower: () => {
      // Custom error throwing
    },
  },
  requestInterceptors: [
    (url, options) => {
      const token = localStorage.getItem("token");
      if (token) {
        const headers = {
          ...options.headers,
          Authorization: `Bearer ${token}`,
        };
        return {
          url,
          options: { ...options, headers },
        };
      }
      return { url, options };
    },
  ],
  responseInterceptors: [
    (response) => {
      const { data } = response as any;
      if (data?.success === false) {
        // Handle business error
      }
      return response;
    },
  ],
};
