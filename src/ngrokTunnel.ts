import ngrok from '@ngrok/ngrok';

export async function startNgrokTunnel(
  port: number,
  authtoken: string,
  domain?: string
): Promise<{ url: string; stop: () => Promise<void> }> {
  try {
    const config: any = {
      addr: port,
      authtoken: authtoken
    };

    if (domain) {
      config.domain = domain;
    }

    console.log(`Starting ngrok tunnel to port ${port}...`);
    const listener = await ngrok.forward(config);
    const url = listener.url() || '';
    console.log(`ngrok tunnel established at: ${url}`);

    return {
      url,
      stop: async () => {
        try {
          await listener.close();
          console.log('ngrok tunnel closed.');
        } catch (e) {
          console.error('Error closing ngrok tunnel:', e);
        }
      }
    };
  } catch (error) {
    console.error('Failed to start ngrok tunnel:', error);
    throw error;
  }
}
