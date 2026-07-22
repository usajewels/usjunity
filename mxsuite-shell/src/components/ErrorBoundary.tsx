import React, { Component, ErrorInfo } from 'react';
import { Result, Button } from 'antd';

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Module load error:', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="warning"
          title={this.props.fallbackTitle || 'Module failed to load'}
          subTitle="This section is temporarily unavailable. Please try again."
          extra={
            <Button type="primary" onClick={() => this.setState({ hasError: false })}>
              Retry
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
