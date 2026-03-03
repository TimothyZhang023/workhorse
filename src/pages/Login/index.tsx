import { LoginForm, ProFormText } from '@ant-design/pro-components';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { message, Tabs } from 'antd';
import { useState } from 'react';
import { useModel } from '@umijs/max';
import { login, register } from '@/services/api';

export default () => {
  const [type, setType] = useState<string>('login');
  const { login: loginModel } = useModel('global');

  const handleSubmit = async (values: API.LoginParams & { confirmPassword?: string }) => {
    try {
      if (type === 'register') {
        if (values.password !== values.confirmPassword) {
          message.error('两次输入的密码不一致');
          return;
        }
        const res = await register(values);
        if (res.token) {
          message.success('注册成功');
          loginModel(res.user, res.token);
        }
      } else {
        const res = await login(values);
        if (res.token) {
          message.success('登录成功');
          loginModel(res.user, res.token);
        }
      }
    } catch (error: any) {
      const msg =
        error?.response?.data?.error ||
        error?.data?.error ||
        error?.message ||
        (type === 'login' ? '登录失败，请检查用户名或密码' : '注册失败，请稍后重试');
      message.error(msg);
    }
  };

  return (
    <div style={{ backgroundColor: '#f0f4f9', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <LoginForm
        logo={null}
        title="Gemini Chat"
        subTitle="A Gemini-style AI chat application"
        submitter={{
          searchConfig: {
            submitText: type === 'login' ? '登录' : '注册',
          },
        }}
        onFinish={async (values) => {
          await handleSubmit(values as any);
        }}
      >
        <Tabs
          activeKey={type}
          onChange={setType}
          centered
          items={[
            {
              key: 'login',
              label: '账号登录',
            },
            {
              key: 'register',
              label: '账号注册',
            },
          ]}
        />

        <ProFormText
          name="username"
          fieldProps={{
            size: 'large',
            prefix: <UserOutlined className={'prefixIcon'} />,
          }}
          placeholder={'用户名'}
          rules={[
            {
              required: true,
              message: '请输入用户名!',
            },
          ]}
        />
        <ProFormText.Password
          name="password"
          fieldProps={{
            size: 'large',
            prefix: <LockOutlined className={'prefixIcon'} />,
          }}
          placeholder={'密码'}
          rules={[
            {
              required: true,
              message: '请输入密码！',
            },
          ]}
        />

        {type === 'register' && (
          <ProFormText.Password
            name="confirmPassword"
            fieldProps={{
              size: 'large',
              prefix: <LockOutlined className={'prefixIcon'} />,
            }}
            placeholder={'确认密码'}
            rules={[
              {
                required: true,
                message: '请确认密码！',
              },
            ]}
          />
        )}
      </LoginForm>
    </div>
  );
};
